// server.js - API Server para Dashboard DayZ
const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const { startBeLogMonitor, getPlayerGuid, getPlayerIp, calculateSessionTime } = require('./utils/be-parser');
const { Client, GatewayIntentBits } = require('discord.js');
// PlayerModel removido - usando MongoDB nativo para melhor performance
require('dotenv').config();

const app = express();
const PORT = process.env.API_PORT || 3000;

// Configurações
const config = {
    mongo: {
        url: process.env.MONGO_URL || 'mongodb://localhost:27017',
        dbName: process.env.DATABASE_NAME || 'dayz_server'
    },
    discord: {
        token: process.env.DISCORD_TOKEN,
        guildId: process.env.GUILD_ID,
        verifiedRoleId: process.env.ROLE_VERIFIED
    }
};

let db;
let playersCollection;
let discordClient;

// ==================== CACHE DE JOGADORES CONECTADOS ====================
// Cache para rastrear jogadores realmente conectados (evita spam de logs em respawn)
const connectedPlayers = new Map(); // Map<steamId, { playerName, connectedAt }>

// Rate Limiting
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,  // 15 minutos
    max: 100,  // Máximo 100 requests por window
    message: { error: 'Muitas requisições. Tente novamente em alguns minutos.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Servir dashboard HTML
app.use('/api/', apiLimiter);  // Aplicar rate limit apenas nas rotas da API

// Conectar ao MongoDB
async function connectMongo() {
    try {
        const client = await MongoClient.connect(config.mongo.url);
        db = client.db(config.mongo.dbName);
        playersCollection = db.collection('players');

        // Verificar e corrigir índices se necessário
        try {
            const existingIndexes = await playersCollection.indexes();
            const steamIdIndex = existingIndexes.find(idx => idx.name === 'steamId_1');

            // Se índice existe mas não é único, remover e recriar
            if (steamIdIndex && !steamIdIndex.unique) {
                console.log('🔄 Corrigindo índice steamId (adicionando unique)...');
                await playersCollection.dropIndex('steamId_1');
                await playersCollection.createIndex({ steamId: 1 }, { unique: true });
                console.log('✅ Índice steamId corrigido');
            } else if (!steamIdIndex) {
                // Criar índice se não existir
                await playersCollection.createIndex({ steamId: 1 }, { unique: true });
            }
        } catch (indexError) {
            // Se já existir com configuração correta, ignorar erro
            if (indexError.code !== 85 && indexError.code !== 86) {
                console.warn('⚠️ Aviso ao configurar índice steamId:', indexError.message);
            }
        }

        // Criar outros índices (ignorar se já existirem)
        const secondaryIndexes = [
            { key: { knownSteamIds: 1 } },
            { key: { hardwareId: 1 } },
            { key: { discordId: 1 } },
            { key: { verified: 1 } }
        ];

        for (const idx of secondaryIndexes) {
            try {
                await playersCollection.createIndex(idx.key);
            } catch (err) {
                // Ignorar se índice já existir (erro 85 ou 86)
                if (err.code !== 85 && err.code !== 86) {
                    console.warn('⚠️ Aviso ao criar índice:', err.message);
                }
            }
        }

        console.log('✅ MongoDB conectado');
    } catch (error) {
        console.error('❌ Erro ao conectar MongoDB:', error);
        process.exit(1);
    }
}

// Conectar Discord Client (para verificação de roles)
async function connectDiscord() {
    try {
        if (!config.discord.token) {
            console.warn('⚠️ DISCORD_TOKEN não configurado - verificações Discord desabilitadas');
            return;
        }

        discordClient = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMembers
            ]
        });

        discordClient.once('ready', () => {
            console.log(`✅ Discord Bot conectado: ${discordClient.user.tag}`);
        });

        await discordClient.login(config.discord.token);
    } catch (error) {
        console.error('❌ Erro ao conectar Discord:', error);
        console.warn('⚠️ Continuando sem Discord - verificações desabilitadas');
    }
}

// ==================== FUNÇÕES DE VERIFICAÇÃO ====================

/**
 * Verificar se o player tem a role de verificado no Discord
 */
async function checkDiscordVerification(primarySteamId) {
    try {
        // Se Discord não está conectado, retornar false
        if (!discordClient || !discordClient.isReady()) {
            console.log('[DISCORD] Bot não está conectado');
            return {
                verified: false,
                needsLinking: false,
                discordDisabled: true
            };
        }

        // Buscar player no banco (compatível com estrutura existente)
        const player = await db.collection('players').findOne({
            $or: [
                { steamId: primarySteamId },
                { knownSteamIds: primarySteamId },
                { primarySteamId: primarySteamId }
            ]
        });

        if (!player || !player.discordId) {
            return {
                verified: false,
                needsLinking: true
            };
        }

        // Buscar guild
        const guild = await discordClient.guilds.fetch(config.discord.guildId).catch(() => null);
        if (!guild) {
            console.log('[DISCORD] Guild não encontrada');
            return { verified: false };
        }

        // Buscar membro
        const member = await guild.members.fetch(player.discordId).catch(() => null);
        if (!member) {
            console.log(`[DISCORD] Membro ${player.discordId} não encontrado no servidor`);
            return { verified: false, inServer: false };
        }

        // Verificar role (suporta ID da role ou nome)
        let hasRole = false;

        // Tentar por ID primeiro
        if (config.discord.verifiedRoleId) {
            hasRole = member.roles.cache.has(config.discord.verifiedRoleId);
        }

        // Se não encontrou por ID, tentar por nome (compatibilidade)
        if (!hasRole) {
            const verifiedRole = guild.roles.cache.find(role => role.name === 'Verificado');
            if (verifiedRole) {
                hasRole = member.roles.cache.has(verifiedRole.id);
            }
        }

        return {
            verified: hasRole,
            inServer: true,
            discordId: player.discordId,
            discordUsername: member.user.tag
        };

    } catch (error) {
        console.error('[DISCORD] Erro ao verificar:', error);
        return { verified: false, error: error.message };
    }
}

/**
 * Middleware de autenticação para chamadas do launcher
 */
function authenticateToken(req, res, next) {
    const token = req.body.serverAuth || req.headers.authorization;

    if (token !== process.env.SERVER_AUTH) {
        return res.status(401).json({
            success: false,
            message: 'Token inválido ou não fornecido'
        });
    }

    next();
}

// ==================== ROTAS DA API ====================

// Status geral do servidor
app.get('/api/status', async (req, res) => {
    try {
        const [
            totalPlayers,
            onlinePlayers,
            totalKills,
            serverStats
        ] = await Promise.all([
            db.collection('players').countDocuments(),
            db.collection('players').countDocuments({ online: true }),
            db.collection('logs').countDocuments({ 
                type: 'kill',
                timestamp: { $gte: getToday() }
            }),
            db.collection('server_stats').findOne({ current: true })
        ]);

        res.json({
            online: true,
            uptime: serverStats?.uptime || 0,
            players: {
                total: totalPlayers,
                online: onlinePlayers,
                max: serverStats?.maxPlayers || 60
            },
            stats: {
                killsToday: totalKills
            },
            performance: {
                cpu: serverStats?.cpu || 0,
                ram: serverStats?.ram || 0,
                fps: serverStats?.fps || 0,
                ping: serverStats?.avgPing || 0
            }
        });
    } catch (error) {
        console.error('Erro em /api/status:', error);
        res.status(500).json({ error: 'Erro ao buscar status' });
    }
});

// Jogadores online
app.get('/api/players/online', async (req, res) => {
    try {
        const players = await db.collection('players')
            .find({ online: true })
            .project({ 
                name: 1, 
                steamId: 1, 
                kills: 1, 
                deaths: 1, 
                playTime: 1,
                money: 1 
            })
            .toArray();

        res.json(players.map(p => ({
            name: p.name,
            steamId: p.steamId,
            kills: p.kills || 0,
            deaths: p.deaths || 0,
            playtime: Math.floor((p.playTime || 0) / 60),
            money: p.money || 0,
            kd: ((p.kills || 0) / (p.deaths || 1)).toFixed(2)
        })));
    } catch (error) {
        console.error('Erro em /api/players/online:', error);
        res.status(500).json({ error: 'Erro ao buscar jogadores online' });
    }
});

// Top jogadores
app.get('/api/players/top/:type', async (req, res) => {
    try {
        const { type } = req.params;
        const limit = parseInt(req.query.limit) || 10;
        
        let sortField;
        switch(type) {
            case 'kills':
                sortField = 'kills';
                break;
            case 'money':
                sortField = 'money';
                break;
            case 'playtime':
                sortField = 'playTime';
                break;
            default:
                return res.status(400).json({ error: 'Tipo inválido' });
        }

        const players = await db.collection('players')
            .find({})
            .sort({ [sortField]: -1 })
            .limit(limit)
            .toArray();

        res.json(players.map(p => ({
            name: p.name,
            steamId: p.steamId,
            kills: p.kills || 0,
            deaths: p.deaths || 0,
            money: p.money || 0,
            playtime: Math.floor((p.playTime || 0) / 60),
            kd: ((p.kills || 0) / (p.deaths || 1)).toFixed(2)
        })));
    } catch (error) {
        console.error('Erro em /api/players/top:', error);
        res.status(500).json({ error: 'Erro ao buscar ranking' });
    }
});

// Buscar jogador específico
app.get('/api/player/:identifier', async (req, res) => {
    try {
        const { identifier } = req.params;
        
        const player = await db.collection('players').findOne({
            $or: [
                { steamId: identifier },
                { name: { $regex: identifier, $options: 'i' } },
                { discordId: identifier }
            ]
        });

        if (!player) {
            return res.status(404).json({ error: 'Jogador não encontrado' });
        }

        // Buscar últimas atividades
        const recentKills = await db.collection('logs')
            .find({ 
                type: 'kill',
                killer: player.name 
            })
            .sort({ timestamp: -1 })
            .limit(5)
            .toArray();

        res.json({
            name: player.name,
            steamId: player.steamId,
            discordId: player.discordId,
            stats: {
                kills: player.kills || 0,
                deaths: player.deaths || 0,
                kd: ((player.kills || 0) / (player.deaths || 1)).toFixed(2),
                money: player.money || 0,
                playtime: Math.floor((player.playTime || 0) / 60)
            },
            status: {
                online: player.online || false,
                lastLogin: player.lastLogin
            },
            recentKills: recentKills.map(k => ({
                victim: k.victim,
                weapon: k.weapon,
                distance: k.distance,
                timestamp: k.timestamp
            }))
        });
    } catch (error) {
        console.error('Erro em /api/player:', error);
        res.status(500).json({ error: 'Erro ao buscar jogador' });
    }
});

// Estatísticas gerais
app.get('/api/stats', async (req, res) => {
    try {
        const [
            totalPlayers,
            totalKills,
            totalDeaths,
            totalMoney,
            avgPlaytime
        ] = await Promise.all([
            db.collection('players').countDocuments(),
            db.collection('players').aggregate([
                { $group: { _id: null, total: { $sum: '$kills' } } }
            ]).toArray(),
            db.collection('players').aggregate([
                { $group: { _id: null, total: { $sum: '$deaths' } } }
            ]).toArray(),
            db.collection('players').aggregate([
                { $group: { _id: null, total: { $sum: '$money' } } }
            ]).toArray(),
            db.collection('players').aggregate([
                { $group: { _id: null, avg: { $avg: '$playTime' } } }
            ]).toArray()
        ]);

        res.json({
            totalPlayers,
            totalKills: totalKills[0]?.total || 0,
            totalDeaths: totalDeaths[0]?.total || 0,
            totalMoney: totalMoney[0]?.total || 0,
            avgPlaytime: Math.floor((avgPlaytime[0]?.avg || 0) / 60),
            globalKD: ((totalKills[0]?.total || 0) / (totalDeaths[0]?.total || 1)).toFixed(2)
        });
    } catch (error) {
        console.error('Erro em /api/stats:', error);
        res.status(500).json({ error: 'Erro ao buscar estatísticas' });
    }
});

// Logs recentes (kills)
app.get('/api/logs/kills', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 20;
        
        const kills = await db.collection('logs')
            .find({ type: 'kill' })
            .sort({ timestamp: -1 })
            .limit(limit)
            .toArray();

        res.json(kills.map(k => ({
            killer: k.killer,
            victim: k.victim,
            weapon: k.weapon,
            distance: k.distance,
            location: k.location,
            timestamp: k.timestamp
        })));
    } catch (error) {
        console.error('Erro em /api/logs/kills:', error);
        res.status(500).json({ error: 'Erro ao buscar logs' });
    }
});

// Logs de conexões
app.get('/api/logs/connections', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 20;
        
        const connections = await db.collection('logs')
            .find({ type: { $in: ['connect', 'disconnect'] } })
            .sort({ timestamp: -1 })
            .limit(limit)
            .toArray();

        res.json(connections.map(c => ({
            type: c.type,
            playerName: c.playerName,
            steamId: c.steamId,
            timestamp: c.timestamp
        })));
    } catch (error) {
        console.error('Erro em /api/logs/connections:', error);
        res.status(500).json({ error: 'Erro ao buscar conexões' });
    }
});

// Estatísticas de economia
app.get('/api/economy', async (req, res) => {
    try {
        const [
            totalMoney,
            richestPlayers,
            recentTransactions
        ] = await Promise.all([
            db.collection('players').aggregate([
                { $group: { _id: null, total: { $sum: '$money' } } }
            ]).toArray(),
            db.collection('players')
                .find({})
                .sort({ money: -1 })
                .limit(5)
                .toArray(),
            db.collection('logs')
                .find({ type: 'transaction' })
                .sort({ timestamp: -1 })
                .limit(10)
                .toArray()
        ]);

        res.json({
            totalMoney: totalMoney[0]?.total || 0,
            richestPlayers: richestPlayers.map(p => ({
                name: p.name,
                money: p.money
            })),
            recentTransactions: recentTransactions.map(t => ({
                from: t.from,
                to: t.to,
                amount: t.amount,
                timestamp: t.timestamp
            }))
        });
    } catch (error) {
        console.error('Erro em /api/economy:', error);
        res.status(500).json({ error: 'Erro ao buscar economia' });
    }
});

// Relatório do dia
app.get('/api/reports/daily', async (req, res) => {
    try {
        const today = getToday();
        
        const [
            killsToday,
            uniquePlayers,
            newPlayers,
            topKiller
        ] = await Promise.all([
            db.collection('logs').countDocuments({
                type: 'kill',
                timestamp: { $gte: today }
            }),
            db.collection('logs').distinct('steamId', {
                type: 'connect',
                timestamp: { $gte: today }
            }),
            db.collection('players').countDocuments({
                firstJoin: { $gte: today }
            }),
            db.collection('logs').aggregate([
                { $match: { type: 'kill', timestamp: { $gte: today } } },
                { $group: { _id: '$killer', count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $limit: 1 }
            ]).toArray()
        ]);

        res.json({
            date: today,
            killsToday,
            uniquePlayers: uniquePlayers.length,
            newPlayers,
            topKiller: topKiller[0] ? {
                name: topKiller[0]._id,
                kills: topKiller[0].count
            } : null
        });
    } catch (error) {
        console.error('Erro em /api/reports/daily:', error);
        res.status(500).json({ error: 'Erro ao gerar relatório' });
    }
});

// Whitelist
app.get('/api/whitelist', async (req, res) => {
    try {
        const whitelist = await db.collection('whitelist')
            .find({})
            .toArray();

        res.json(whitelist.map(w => ({
            steamId: w.steamId,
            addedBy: w.addedBy,
            addedAt: w.addedAt
        })));
    } catch (error) {
        console.error('Erro em /api/whitelist:', error);
        res.status(500).json({ error: 'Erro ao buscar whitelist' });
    }
});

// Warns
app.get('/api/warnings/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        
        const warnings = await db.collection('warnings')
            .find({ userId })
            .sort({ timestamp: -1 })
            .toArray();

        res.json(warnings.map(w => ({
            reason: w.reason,
            moderator: w.moderator,
            timestamp: w.timestamp
        })));
    } catch (error) {
        console.error('Erro em /api/warnings:', error);
        res.status(500).json({ error: 'Erro ao buscar warns' });
    }
});

// ==================== FUNÇÕES AUXILIARES ====================

function getToday() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
}

// ==================== ENDPOINTS PARA UNIVERSAL API ====================

// Status check - Universal API verifica se a API está viva (GET para browser)
app.get('/', (req, res) => {
    try {
        // Formato esperado pelo mod Universal API
        res.json({
            Status: 'Success',
            Error: 'noerror',
            Version: '1.3.2', // Versão compatível com o mod
            Discord: 'Disabled',
            Translate: 'Disabled',
            Wit: [],
            QnA: [],
            LUIS: []
        });
    } catch (error) {
        console.error('Erro no status check:', error);
        res.status(500).json({
            Status: 'Error',
            Error: 'Internal server error'
        });
    }
});

// Status check - POST endpoint usado pelo mod Universal API
app.post('/Status', (req, res) => {
    try {
        console.log('[UAPI] Status check recebido do servidor DayZ');
        // Formato esperado pelo mod Universal API
        res.json({
            Status: 'Success',
            Error: 'noerror',
            Version: '1.3.2', // Versão compatível com o mod
            Discord: 'Disabled',
            Translate: 'Disabled',
            Wit: [],
            QnA: [],
            LUIS: []
        });
    } catch (error) {
        console.error('[UAPI] Erro no status check:', error);
        res.status(500).json({
            Status: 'Error',
            Error: 'Internal server error'
        });
    }
});

// Dashboard HTML
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Rota de health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date() });
});

// Endpoint para verificação de jogador
app.post('/api/verify-player', async (req, res) => {
    try {
        const { steamId, serverAuth } = req.body;
        
        // Verificar autenticação do servidor
        if (serverAuth !== process.env.SERVER_AUTH) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        
        // Buscar jogador verificado
        const player = await db.collection('verified_users').findOne({ steamId });
        
        if (player) {
            res.json({
                verified: true,
                discordId: player.discordId,
                discordTag: player.discordTag
            });
        } else {
            res.json({ verified: false });
        }
    } catch (error) {
        console.error('Erro ao verificar jogador:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==================== ENDPOINT LAUNCHER: REGISTRO E VERIFICAÇÃO ====================

/**
 * Endpoint principal para receber dados do launcher
 * Registra/atualiza player com dados de hardware e verifica Discord
 */
app.post('/api/security/register', authenticateToken, async (req, res) => {
    try {
        const {
            primarySteamId,
            steamIds,
            hardwareId,
            ipAddress,
            launcherVersion,
            machineName,
            osVersion,
            cpuId,
            motherboardSerial,
            gpuId,
            diskSerials,
            macAddresses,
            biosSerial,
            windowsProductId,
            ramSerialNumbers,
            networkAdapterIds
        } = req.body;

        console.log(`[LAUNCHER API] 📥 ${primarySteamId}`);

        if (!primarySteamId || !hardwareId) {
            return res.status(400).json({
                success: false,
                message: 'Steam ID ou Hardware ID faltando'
            });
        }

        // Buscar player existente
        const existingPlayer = await playersCollection.findOne({
            $or: [
                { steamId: primarySteamId },
                { knownSteamIds: primarySteamId }
            ]
        });

        const isNewPlayer = !existingPlayer;
        const mainSteamId = existingPlayer ? existingPlayer.steamId : primarySteamId;
        const now = new Date();

        // Preparar operação UPSERT (cria ou atualiza em 1 operação atômica)
        const updateData = {
            $set: {
                lastLogin: now,
                lastUpdate: now,
                lastLauncherCheck: now,
                lastLauncherVersion: launcherVersion,
                machineName: machineName,
                osVersion: osVersion,
                lastIp: ipAddress,
                hardwareId: hardwareId,
                cpuId: cpuId || null,
                motherboardSerial: motherboardSerial || null,
                gpuId: gpuId || null,
                biosSerial: biosSerial || null,
                windowsProductId: windowsProductId || null
            },
            $addToSet: {
                // $addToSet evita duplicatas automaticamente
                knownSteamIds: { $each: steamIds || [primarySteamId] },
                diskSerials: { $each: diskSerials || [] },
                macAddresses: { $each: macAddresses || [] },
                ramSerialNumbers: { $each: ramSerialNumbers || [] },
                networkAdapterIds: { $each: networkAdapterIds || [] }
            }
        };

        // Se for novo player, definir valores iniciais
        if (isNewPlayer) {
            updateData.$setOnInsert = {
                steamId: primarySteamId,
                firstJoin: now,
                guid: null,
                guidSource: 'launcher',
                guidUpdatedAt: null,
                discordId: null,
                discordTag: null,
                steamName: null,
                verified: false,
                verifiedAt: null,
                launcherVerified: false,
                awaitingGuid: true,
                name: '',
                kills: 0,
                deaths: 0,
                kdRatio: 0,
                zombieKills: 0,
                longestKill: 0,
                money: 10000,
                playTime: 0,
                online: false,
                lastSeenInGame: null,
                webhookSent: false,
                webhookSentAt: null,
                clanId: null
            };
        }

        // Verificar Discord
        const discordCheck = await checkDiscordVerification(primarySteamId);

        updateData.$set.verified = discordCheck.verified || false;
        updateData.$set.launcherVerified = discordCheck.verified || false;

        if (discordCheck.verified) {
            updateData.$set.awaitingGuid = false;
            if (!existingPlayer || !existingPlayer.verifiedAt) {
                updateData.$set.verifiedAt = now;
            }
        }

        if (discordCheck.discordId) {
            updateData.$set.discordId = discordCheck.discordId;
        }

        if (discordCheck.discordTag) {
            updateData.$set.discordTag = discordCheck.discordTag;
        }

        // UPSERT: cria ou atualiza em UMA operação atômica
        await playersCollection.updateOne(
            { steamId: mainSteamId },
            updateData,
            { upsert: true }
        );

        console.log(`[LAUNCHER API] ✅ ${isNewPlayer ? 'Criado' : 'Atualizado'}: ${primarySteamId} | Verificado: ${discordCheck.verified}`);

        // Whitelist
        if (discordCheck.verified) {
            try {
                const whitelistPath = process.env.WHITELIST_PATH;
                if (whitelistPath && fs.existsSync(whitelistPath)) {
                    const whitelistContent = fs.readFileSync(whitelistPath, 'utf8');
                    if (!whitelistContent.includes(primarySteamId)) {
                        const discordTag = discordCheck.discordTag || 'Unknown';
                        fs.appendFileSync(whitelistPath, `\n${primarySteamId}\t//${discordTag}`);
                        console.log(`[WHITELIST] ✅ ${primarySteamId} adicionado`);
                    }
                }
            } catch (err) {
                console.error('[WHITELIST] Erro:', err.message);
            }
        }

        // Buscar player atualizado
        const updatedPlayer = await playersCollection.findOne({ steamId: mainSteamId });

        // Resposta para o launcher
        return res.json({
            success: true,
            steamId: primarySteamId,
            guid: updatedPlayer.guid || 'pending',
            verified: updatedPlayer.verified,
            canPlay: updatedPlayer.verified && !updatedPlayer.awaitingGuid,
            awaitingGuid: updatedPlayer.awaitingGuid,
            needsDiscordVerification: !updatedPlayer.verified,
            message: updatedPlayer.verified
                ? 'Verificação concluída com sucesso'
                : 'Verifique sua conta no Discord primeiro'
        });

    } catch (error) {
        console.error('[LAUNCHER API] ❌ Erro:', error);

        return res.status(500).json({
            success: false,
            message: 'Erro interno do servidor'
        });
    }
});

// Endpoint para registrar conexão de jogador
app.post('/api/player-connect', async (req, res) => {
    try {
        const { steamId, playerName, serverAuth } = req.body;

        if (serverAuth !== process.env.SERVER_AUTH) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        // Verificar se o jogador já está conectado (evita spam de logs em respawn/morte)
        const isAlreadyConnected = connectedPlayers.has(steamId);

        if (isAlreadyConnected) {
            console.log(`[CONNECT] ${playerName} já está conectado - ignorando log duplicada`);
            return res.json({ success: true, alreadyConnected: true });
        }

        // Adicionar ao cache de conectados
        connectedPlayers.set(steamId, {
            playerName,
            connectedAt: new Date()
        });

        console.log(`[CONNECT] ✅ ${playerName} conectou (${connectedPlayers.size} players online)`);

        // Buscar dados do MongoDB (IP salvo, Discord vinculado)
        const player = await db.collection('players').findOneAndUpdate(
            { steamId },
            {
                $set: {
                    name: playerName,
                    online: true,
                    lastLogin: new Date()
                }
            },
            { upsert: true, returnDocument: 'after' }
        );

        // Aguardar alguns segundos para o GUID aparecer no BattlEye log
        setTimeout(async () => {
            try {
                // Buscar GUID e IP do BattlEye log parser
                const beGuid = getPlayerGuid(playerName);
                const beIp = getPlayerIp(playerName);
                
                // Buscar dados completos do MongoDB
                const fullPlayer = await db.collection('players').findOne({ steamId });
                
                // Usar IP do BattlEye (mais recente) ou do MongoDB (verificação)
                const playerIp = beIp || fullPlayer?.lastIp || 'N/A';
                const playerGuid = beGuid || fullPlayer?.guid || 'N/A';
                
                // Atualizar GUID no banco se encontrado no BE
                if (beGuid) {
                    await db.collection('players').updateOne(
                        { steamId },
                        { $set: { guid: beGuid } }
                    );
                }
                
                // Enviar embed para Discord
                if (process.env.CONNECTION_WEBHOOK_URL) {
                    // Verificar se player está verificado
                    const isVerified = fullPlayer?.verified === true;
                    const isLauncherVerified = fullPlayer?.launcherVerified === true;
                    
                    // Só mostrar Discord se estiver verificado
                    let discordField = 'Não vinculado (N/A)';
                    if ((isVerified || isLauncherVerified) && fullPlayer?.discordId) {
                        const discordMention = `<@${fullPlayer.discordId}>`;
                        const discordUsername = fullPlayer?.discordTag || 'N/A';
                        discordField = `${discordMention} (${discordUsername})`;
                    }
                    
                    const embed = {
                        title: '🟢 Jogador Conectou',
                        color: 0x00ff00, // Verde
                        fields: [
                            { name: '👤 Jogador', value: playerName, inline: true },
                            { name: '🌐 IP', value: playerIp, inline: true },
                            { name: '🔑 GUID', value: `\`${playerGuid}\``, inline: false },
                            { name: '🎮 Steam64ID', value: `${steamId}\n[Steam Profile](https://steamcommunity.com/profiles/${steamId})`, inline: false },
                            { name: '💬 Discord', value: discordField, inline: false }
                        ],
                        timestamp: new Date().toISOString(),
                        footer: { text: 'DayZ Connection Monitor' }
                    };

                    await axios.post(process.env.CONNECTION_WEBHOOK_URL, {
                        embeds: [embed]
                    }).catch(err => console.error('Erro ao enviar webhook de conexão:', err.message));
                }
            } catch (error) {
                console.error('Erro ao enviar embed de conexão:', error);
            }
        }, 3000); // 3 segundos para GUID aparecer no log
        
        res.json({ success: true });
    } catch (error) {
        console.error('Erro ao registrar conexão:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Endpoint para registrar desconexão
app.post('/api/player-disconnect', async (req, res) => {
    try {
        const { steamId, playerName, sessionTime, serverAuth } = req.body;

        if (serverAuth !== process.env.SERVER_AUTH) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        // Verificar se o jogador estava realmente conectado
        const wasConnected = connectedPlayers.has(steamId);

        if (!wasConnected) {
            console.log(`[DISCONNECT] ${playerName} não estava no cache - ignorando log duplicada`);
            return res.json({ success: true, wasNotConnected: true });
        }

        // Remover do cache de conectados
        connectedPlayers.delete(steamId);
        console.log(`[DISCONNECT] 🔴 ${playerName} desconectou (${connectedPlayers.size} players online)`);

        // Buscar dados do MongoDB
        const player = await db.collection('players').findOneAndUpdate(
            { steamId },
            { $set: { online: false } },
            { returnDocument: 'after' }
        );

        // Enviar embed para Discord
        if (process.env.CONNECTION_WEBHOOK_URL) {
            // Buscar dados atualizados do MongoDB
            const fullPlayer = await db.collection('players').findOne({ steamId });
            
            // Verificar se player está verificado
            const isVerified = fullPlayer?.verified === true;
            const isLauncherVerified = fullPlayer?.launcherVerified === true;
            
            // Só mostrar Discord se estiver verificado
            let discordField = 'Não vinculado (N/A)';
            if ((isVerified || isLauncherVerified) && fullPlayer?.discordId) {
                const discordMention = `<@${fullPlayer.discordId}>`;
                const discordUsername = fullPlayer?.discordTag || 'N/A';
                discordField = `${discordMention} (${discordUsername})`;
            }
            
            // Buscar GUID do BattlEye ou MongoDB
            const beGuid = getPlayerGuid(playerName);
            const playerGuid = beGuid || fullPlayer?.guid || 'N/A';
            
            // Buscar IP do BattlEye ou MongoDB
            const beIp = getPlayerIp(playerName);
            const playerIp = beIp || fullPlayer?.lastIp || 'N/A';
            
            // Calcular tempo de sessão usando timestamps do BattlEye
            const beSessionMinutes = calculateSessionTime(playerName, new Date());
            const sessionMinutes = beSessionMinutes > 0 ? beSessionMinutes : (sessionTime || 0);
            const sessionFormatted = sessionMinutes > 60 
                ? `${Math.floor(sessionMinutes/60)}h${sessionMinutes%60}m` 
                : `${sessionMinutes}m`;
            
            const embed = {
                title: '🔴 Jogador Desconectou',
                color: 0xff0000, // Vermelho
                fields: [
                    { name: '👤 Jogador', value: playerName || 'Desconhecido', inline: true },
                    { name: '🌐 IP', value: playerIp, inline: true },
                    { name: '⏱️ Sessão', value: sessionFormatted, inline: true },
                    { name: '🔑 GUID', value: `\`${playerGuid}\``, inline: false },
                    { name: '🎮 Steam64ID', value: `${steamId}\n[Steam Profile](https://steamcommunity.com/profiles/${steamId})`, inline: false },
                    { name: '💬 Discord', value: discordField, inline: false }
                ],
                timestamp: new Date().toISOString(),
                footer: { text: 'DayZ Connection Monitor' }
            };

            await axios.post(process.env.CONNECTION_WEBHOOK_URL, {
                embeds: [embed]
            }).catch(err => console.error('Erro ao enviar webhook de desconexão:', err.message));
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Erro ao registrar desconexão:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==================== PLAYTIME ENDPOINT ====================

// Endpoint para receber atualizações de playtime do mod customizado
app.post('/api/player-stats', async (req, res) => {
    try {
        const { steamId, playtime, serverAuth } = req.body;

        if (serverAuth !== process.env.SERVER_AUTH) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        await db.collection('players').updateOne(
            { steamId },
            {
                $set: {
                    playTime: parseInt(playtime) || 0,
                    lastUpdate: new Date()
                }
            },
            { upsert: true }
        );

        console.log(`[PLAYTIME] ${steamId} - ${playtime} minutos`);
        res.json({ success: true });
    } catch (error) {
        console.error('Erro ao atualizar playtime:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Endpoint para buscar métricas avançadas de um jogador
app.get('/api/player/:identifier/advanced', async (req, res) => {
    try {
        const { identifier } = req.params;

        const player = await db.collection('players').findOne({
            $or: [
                { steamId: identifier },
                { name: { $regex: identifier, $options: 'i' } }
            ]
        });

        if (!player) {
            return res.status(404).json({ error: 'Jogador não encontrado' });
        }

        // Calcular kill streak atual
        const recentKills = await db.collection('logs')
            .find({
                type: 'kill',
                killerSteamId: player.steamId
            })
            .sort({ timestamp: -1 })
            .limit(100)
            .toArray();

        // Buscar arma favorita
        const favoriteWeapon = await db.collection('logs').aggregate([
            { $match: { type: 'kill', killerSteamId: player.steamId } },
            { $group: { _id: '$weapon', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 1 }
        ]).toArray();

        // Calcular média de distância de kills
        const avgDistance = await db.collection('logs').aggregate([
            { $match: { type: 'kill', killerSteamId: player.steamId } },
            { $group: { _id: null, avg: { $avg: '$distance' } } }
        ]).toArray();

        res.json({
            steamId: player.steamId,
            name: player.name,
            stats: {
                kills: player.kills || 0,
                deaths: player.deaths || 0,
                kd: ((player.kills || 0) / (player.deaths || 1)).toFixed(2),
                longestKill: player.longestKill || 0,
                playtime: Math.floor((player.playTime || 0) / 60),
                money: player.money || 0
            },
            advanced: {
                favoriteWeapon: favoriteWeapon[0]?._id || 'N/A',
                weaponKills: favoriteWeapon[0]?.count || 0,
                avgKillDistance: Math.floor(avgDistance[0]?.avg || 0),
                recentKillCount: recentKills.length
            }
        });
    } catch (error) {
        console.error('Erro em /api/player/advanced:', error);
        res.status(500).json({ error: 'Erro ao buscar métricas avançadas' });
    }
});

// Endpoint para buscar top longest kills
app.get('/api/players/top/longest-kills', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;

        const players = await db.collection('players')
            .find({ longestKill: { $exists: true, $gt: 0 } })
            .sort({ longestKill: -1 })
            .limit(limit)
            .toArray();

        res.json(players.map(p => ({
            name: p.name,
            steamId: p.steamId,
            longestKill: p.longestKill,
            kills: p.kills || 0,
            deaths: p.deaths || 0
        })));
    } catch (error) {
        console.error('Erro em /api/players/top/longest-kills:', error);
        res.status(500).json({ error: 'Erro ao buscar longest kills' });
    }
});

// Endpoint para admin logs
app.get('/api/logs/admin', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 20;

        const adminLogs = await db.collection('logs')
            .find({ type: 'admin_action' })
            .sort({ timestamp: -1 })
            .limit(limit)
            .toArray();

        res.json(adminLogs.map(log => ({
            adminName: log.adminName,
            action: log.action,
            target: log.target,
            reason: log.reason,
            timestamp: log.timestamp
        })));
    } catch (error) {
        console.error('Erro em /api/logs/admin:', error);
        res.status(500).json({ error: 'Erro ao buscar admin logs' });
    }
});

// ==================== KILL FEED ENDPOINT ====================

// Endpoint para registrar kill (enviado pelo mod killfeedAPI)
app.post('/api/kill', async (req, res) => {
    try {
        // Verificar autenticação
        const authHeader = req.headers.authorization;
        const serverAuth = process.env.SERVER_AUTH;
        
        if (!serverAuth || authHeader !== serverAuth) {
            console.warn('[KILL] Tentativa não autorizada');
            return res.status(401).json({ error: 'Não autorizado' });
        }

        const {
            killerName,
            killerSteamId,
            victimName,
            victimSteamId,
            weapon,
            distance = 0,
            deathType = 'pvp', // Tipo de morte: pvp, suicide, vehicle, animal, bleed, environment
            killerPosition,
            victimPosition,
            timestamp = new Date()
        } = req.body;

        // Log diferenciado por tipo de morte
        const deathEmojis = {
            pvp: '⚔️',
            suicide: '💀',
            vehicle: '🚗',
            animal: '🐊',
            bleed: '🩸',
            environment: '⚠️'
        };
        const emoji = deathEmojis[deathType] || '☠️';

        console.log(`[${deathType.toUpperCase()}] ${emoji} ${killerName} → ${victimName} [${weapon}] (${distance}m)`);
        
        if (killerPosition && victimPosition) {
            console.log(`  📍 Posições: Killer <${killerPosition}> | Victim <${victimPosition}>`);
        } else if (victimPosition) {
            console.log(`  📍 Posição Vítima: <${victimPosition}>`);
        }

        // Buscar jogadores no banco
        let killerPlayer = null;
        let victimPlayer = null;

        if (killerSteamId) {
            killerPlayer = await db.collection('players').findOne({ steamId: killerSteamId });
        }

        if (victimSteamId) {
            victimPlayer = await db.collection('players').findOne({ steamId: victimSteamId });
        }

        // Atualizar kills do killer
        if (killerPlayer) {
            const updates = {
                $inc: { kills: 1 }
            };

            // Atualizar longest kill
            if (distance > (killerPlayer.longestKill || 0)) {
                updates.$set = { longestKill: distance };
            }

            await db.collection('players').updateOne(
                { _id: killerPlayer._id },
                updates
            );
            
            console.log(`  ✅ ${killerName}: ${(killerPlayer.kills || 0) + 1} kills`);
        } else if (killerSteamId) {
            // Criar jogador se não existir
            await db.collection('players').updateOne(
                { steamId: killerSteamId },
                {
                    $set: { 
                        name: killerName,
                        lastUpdate: new Date()
                    },
                    $inc: { kills: 1 },
                    $setOnInsert: {
                        steamId: killerSteamId,
                        verified: false,
                        deaths: 0,
                        playTime: 0,
                        money: 10000,
                        firstJoin: new Date()
                    }
                },
                { upsert: true }
            );
        }

        // Atualizar deaths da vítima
        if (victimPlayer) {
            await db.collection('players').updateOne(
                { _id: victimPlayer._id },
                { $inc: { deaths: 1 } }
            );
            
            console.log(`  ✅ ${victimName}: ${(victimPlayer.deaths || 0) + 1} deaths`);
        } else if (victimSteamId) {
            // Criar jogador se não existir
            await db.collection('players').updateOne(
                { steamId: victimSteamId },
                {
                    $set: { 
                        name: victimName,
                        lastUpdate: new Date()
                    },
                    $inc: { deaths: 1 },
                    $setOnInsert: {
                        steamId: victimSteamId,
                        verified: false,
                        kills: 0,
                        playTime: 0,
                        money: 10000,
                        firstJoin: new Date()
                    }
                },
                { upsert: true }
            );
        }

        // Salvar log do kill (incluindo tipo de morte e posições se disponíveis)
        const logEntry = {
            type: 'kill',
            deathType, // Tipo de morte: pvp, suicide, vehicle, animal, bleed, environment
            timestamp: new Date(timestamp),
            killer: killerName,
            killerSteamId,
            killerDiscordId: killerPlayer?.discordId,
            victim: victimName,
            victimSteamId,
            victimDiscordId: victimPlayer?.discordId,
            weapon,
            distance
        };

        // Adicionar posições se disponíveis
        if (killerPosition) logEntry.killerPosition = killerPosition;
        if (victimPosition) logEntry.victimPosition = victimPosition;

        await db.collection('logs').insertOne(logEntry);

        res.json({ 
            success: true,
            message: 'Kill registrado com sucesso',
            killerStats: {
                kills: (killerPlayer?.kills || 0) + 1,
                longestKill: Math.max(distance, killerPlayer?.longestKill || 0)
            },
            victimStats: {
                deaths: (victimPlayer?.deaths || 0) + 1
            }
        });

    } catch (error) {
        console.error('Erro em /api/kill:', error);
        res.status(500).json({ error: 'Erro ao registrar kill' });
    }
});

// ==================== NOVOS ENDPOINTS: STATS & WHITELIST ====================

// Middleware de autenticação (para chamadas do mod)
const requireServerAuth = (req, res, next) => {
    const authHeader = req.headers.authorization;
    const serverAuth = process.env.SERVER_AUTH;

    if (!serverAuth) {
        console.warn('⚠️ SERVER_AUTH não configurado no .env!');
        return next();
    }

    if (authHeader !== serverAuth) {
        return res.status(401).json({ error: 'Não autorizado' });
    }

    next();
};

// Verificar jogador (whitelist automática)
app.post('/api/verify-player', requireServerAuth, async (req, res) => {
    try {
        const { steamId, guid, playerName } = req.body;

        console.log(`[VERIFY] Verificando: ${playerName} (Steam: ${steamId}, GUID: ${guid})`);

        // Buscar no MongoDB
        const player = await db.collection('players').findOne({ steamId });

        if (!player) {
            console.log(`[VERIFY] ❌ Jogador não encontrado: ${steamId}`);
            return res.json({
                verified: false,
                launcherVerified: false,
                hasValidGuid: false,
                kickReason: 'Jogador não está registrado no sistema'
            });
        }

        // Verificar se está completo
        const isVerified = player.verified === true;
        const hasLauncher = player.launcherVerified === true;
        const hasGuid = player.guid === guid;

        console.log(`[VERIFY] ${playerName}: verified=${isVerified}, launcher=${hasLauncher}, guid=${hasGuid}`);

        res.json({
            verified: isVerified,
            launcherVerified: hasLauncher,
            hasValidGuid: hasGuid,
            discordTag: player.discordTag || '',
            steamName: player.steamName || '',
            kickReason: !isVerified ? 'Não verificado no Discord' :
                       !hasLauncher ? 'Launcher não verificado' :
                       !hasGuid ? 'GUID inválido' : ''
        });
    } catch (error) {
        console.error('Erro em /api/verify-player:', error);
        res.status(500).json({ error: 'Erro ao verificar jogador' });
    }
});

// Obter estatísticas de um jogador
app.get('/api/player/:steamId/stats', requireServerAuth, async (req, res) => {
    try {
        const { steamId } = req.params;

        const player = await db.collection('players').findOne({ steamId });

        if (!player) {
            return res.status(404).json({ error: 'Jogador não encontrado' });
        }

        // Retornar estatísticas
        res.json({
            steamId: player.steamId,
            playerName: player.name || player.steamName,
            totalKills: player.kills || 0,
            totalDeaths: player.deaths || 0,
            zombiesKilled: player.zombiesKilled || 0,
            animalsKilled: player.animalsKilled || 0,
            totalPlaytime: player.playTime || 0,
            money: player.money || 0,
            kdr: player.deaths > 0 ? (player.kills / player.deaths).toFixed(2) : player.kills || 0
        });
    } catch (error) {
        console.error('Erro em /api/player/:steamId/stats:', error);
        res.status(500).json({ error: 'Erro ao buscar estatísticas' });
    }
});

// Salvar/atualizar estatísticas de um jogador
app.post('/api/player/:steamId/stats', requireServerAuth, async (req, res) => {
    try {
        const { steamId } = req.params;
        const stats = req.body;

        console.log(`[STATS] Atualizando estatísticas: ${stats.playerName || steamId}`);

        // Atualizar no MongoDB
        await db.collection('players').updateOne(
            { steamId },
            {
                $set: {
                    name: stats.playerName,
                    kills: stats.totalKills || 0,
                    deaths: stats.totalDeaths || 0,
                    zombiesKilled: stats.zombiesKilled || 0,
                    animalsKilled: stats.animalsKilled || 0,
                    playTime: stats.totalPlaytime || 0,
                    online: stats.isOnline || false,
                    lastUpdated: new Date()
                },
                $setOnInsert: {
                    steamId,
                    verified: false,
                    firstJoin: new Date()
                }
            },
            { upsert: true }
        );

        res.json({ success: true, message: 'Estatísticas atualizadas' });
    } catch (error) {
        console.error('Erro em /api/player/:steamId/stats:', error);
        res.status(500).json({ error: 'Erro ao salvar estatísticas' });
    }
});

// Leaderboard / Rankings
app.get('/api/leaderboard/:type', async (req, res) => {
    try {
        const { type } = req.params;
        const limit = parseInt(req.query.limit) || 10;

        let sortField;
        switch (type) {
            case 'kills':
                sortField = 'kills';
                break;
            case 'kdr':
                sortField = 'kdr';
                break;
            case 'playtime':
                sortField = 'playTime';
                break;
            case 'money':
                sortField = 'money';
                break;
            case 'zombies':
                sortField = 'zombiesKilled';
                break;
            default:
                return res.status(400).json({ error: 'Tipo inválido' });
        }

        const players = await db.collection('players')
            .find({ verified: true })
            .sort({ [sortField]: -1 })
            .limit(limit)
            .toArray();

        res.json(players.map((p, index) => ({
            rank: index + 1,
            steamId: p.steamId,
            playerName: p.name || p.steamName || 'Desconhecido',
            discordTag: p.discordTag || null,
            value: p[sortField] || 0,
            kills: p.kills || 0,
            deaths: p.deaths || 0,
            kdr: p.deaths > 0 ? (p.kills / p.deaths).toFixed(2) : p.kills || 0,
            playtime: Math.floor((p.playTime || 0) / 60), // Converter para horas
            money: p.money || 0
        })));
    } catch (error) {
        console.error('Erro em /api/leaderboard/:type:', error);
        res.status(500).json({ error: 'Erro ao buscar leaderboard' });
    }
});

// Log de whitelist kicks
app.post('/api/logs/whitelist', requireServerAuth, async (req, res) => {
    try {
        const logData = req.body;

        await db.collection('logs').insertOne({
            ...logData,
            timestamp: new Date()
        });

        console.log(`[WHITELIST KICK] ${logData.playerName} (${logData.steamId})`);

        res.json({ success: true });
    } catch (error) {
        console.error('Erro em /api/logs/whitelist:', error);
        res.status(500).json({ error: 'Erro ao salvar log' });
    }
});

// ==================== INICIALIZAÇÃO ====================

async function startServer() {
    // Conectar MongoDB
    await connectMongo();

    // Conectar Discord (para verificação de roles)
    await connectDiscord();

    // Iniciar monitor do BattlEye
    startBeLogMonitor();

    app.listen(PORT, () => {
        console.log(`✅ API rodando: http://localhost:${PORT}`);
        console.log(`📊 MongoDB: ${db.databaseName}`);
        console.log(`🔐 Endpoint launcher: POST /api/security/register`);
    });
}

// Tratamento de erros
process.on('unhandledRejection', (error) => {
    console.error('❌ Erro não tratado:', error);
});

process.on('SIGINT', () => {
    console.log('\n⚠️ Encerrando servidor...');
    process.exit(0);
});

// Iniciar
startServer().catch(console.error);