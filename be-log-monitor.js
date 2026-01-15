const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const Discord = require('discord.js');
const readline = require('readline');
const { addToWhitelist } = require('./utils/whitelist.js');
const { addCoins } = require('./utils/coins.js');
require('dotenv').config();

const BE_LOG_DIR = process.env.BE_LOG_DIR || 'C:/DayZServer1.28_TESTE/DayZServerModded_TESTE/Bec/Log/config/BeLog';
const CHAT_LOG_DIR = process.env.CHAT_LOG_DIR || 'C:/DayZServer1.28_TESTE/DayZServerModded_TESTE/Bec/Log/config/Chat';
const ERROR_LOG_DIR = process.env.ERROR_LOG_DIR || 'C:/DayZServer1.28_TESTE/DayZServerModded_TESTE/Bec/Log/config/Error';
const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017';
const DATABASE_NAME = process.env.DATABASE_NAME || 'dayz_server';
const WEBHOOK_LOGS = process.env.WEBHOOK_LOGS;

let db;
let watchedFiles = new Map();
let webhookClient;
let discordClient;

async function connectMongo() {
    const client = await MongoClient.connect(MONGO_URL);
    db = client.db(DATABASE_NAME);
    console.log('✅ MongoDB conectado\n');
}

async function initDiscordClient() {
    try {
        const { Client, GatewayIntentBits } = require('discord.js');
        discordClient = new Client({
            intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
        });

        await discordClient.login(process.env.DISCORD_TOKEN);
        console.log('✅ Discord client conectado\n');
    } catch (error) {
        console.error('❌ Erro ao conectar Discord client:', error.message);
    }
}

async function giveVerifiedRole(discordId) {
    if (!discordClient || !discordId) return;

    try {
        const guild = await discordClient.guilds.fetch(process.env.GUILD_ID);
        const member = await guild.members.fetch(discordId);
        const verifiedRole = guild.roles.cache.get(process.env.ROLE_VERIFIED);

        if (member && verifiedRole) {
            await member.roles.add(verifiedRole);
            console.log(`✅ Cargo verificado dado para ${member.user.tag}`);
        }
    } catch (error) {
        console.error('❌ Erro ao dar cargo verificado:', error.message);
    }
}


function initWebhook() {
    if (WEBHOOK_LOGS) {
        webhookClient = new Discord.WebhookClient({ url: WEBHOOK_LOGS });
        console.log('✅ Webhook configurado\n');
    }
}

function getTodayLogFile(dir, prefix) {
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    return path.join(dir, `${prefix}_${dateStr}.log`);
}

async function sendWebhook(embed) {
    if (!webhookClient) return;
    
    try {
        await webhookClient.send({ embeds: [embed] });
    } catch (error) {
        console.error('Erro ao enviar webhook:', error.message);
    }
}

async function processBeLogLine(line) {
    try {
        // Player conectou
        const connectMatch = line.match(/(\d{2}:\d{2}:\d{2}) : Player #(\d+) (.+?) \((.+?):(\d+)\) connected/);
        if (connectMatch) {
            const [, time, playerId, playerName, playerIp] = connectMatch;
            console.log(`${time} ✅ Conectou: ${playerName} (${playerIp})`);
            
            await db.collection('temp_connections').insertOne({
                playerId: parseInt(playerId),
                playerName: playerName,
                playerIp: playerIp,
                connectedAt: new Date(),
                time: time
            });

            // ⚠️ Webhook de conexão simples REMOVIDO - apenas logs detalhados com GUID
        }

        // GUID recebido - PONTO CRÍTICO
        const guidMatch = line.match(/(\d{2}:\d{2}:\d{2}) : Player #(\d+) (.+?) - BE GUID: ([a-f0-9]{32})/);
        if (guidMatch) {
            const [, time, playerId, playerName, guid] = guidMatch;
            console.log(`${time} 🔑 GUID: ${playerName} -> ${guid}`);

            const tempConn = await db.collection('temp_connections').findOne({
                playerId: parseInt(playerId)
            });

            if (tempConn) {
                await updatePlayerGuid(tempConn.playerIp, guid, playerName, time);
            }
        }

        // Player desconectou
        const disconnectMatch = line.match(/(\d{2}:\d{2}:\d{2}) : Player #(\d+) (.+?) disconnected/);
        if (disconnectMatch) {
            const [, time, playerId, playerName] = disconnectMatch;
            console.log(`${time} 🔴 Desconectou: ${playerName}`);
            
            // Limpar temp_connections (não enviar webhook)
            await db.collection('temp_connections').deleteOne({
                playerId: parseInt(playerId)
            });
        }

        // RCon admin login (apenas log no console, sem webhook)
        const rconMatch = line.match(/(\d{2}:\d{2}:\d{2}) : RCon admin #(\d+) \((.+?):(\d+)\) logged in/);
        if (rconMatch) {
            const [, time, adminId, ip] = rconMatch;
            console.log(`${time} 👮 RCon Admin #${adminId} (${ip})`);
            // Webhook removido - não é relevante para logs públicos
        }

    } catch (error) {
        console.error('Erro ao processar linha BE:', error.message);
    }
}

// FUNÇÃO CRÍTICA: Matching GUID → Player
async function updatePlayerGuid(playerIp, guid, inGameName, time) {
    try {
        console.log(`\n🔍 Tentando mapear GUID: ${guid}`);
        console.log(`   📡 IP: ${playerIp} | 🎮 In-Game: ${inGameName}`);

        // Estratégia 1: Buscar por IP recente (últimos 10 minutos) + VERIFICADO + MAIS RECENTE
        let player = await db.collection('players').findOne(
            {
                lastIp: playerIp,
                lastLauncherCheck: { $gte: new Date(Date.now() - 10 * 60 * 1000) },
                awaitingGuid: true,
                verified: true, // CRÍTICO: Só quem verificou no Discord
                launcherVerified: true // CRÍTICO: Só quem abriu o launcher
            },
            {
                sort: { lastLauncherCheck: -1 } // Ordena do mais recente para o mais antigo
            }
        );

        if (player) {
            console.log(`   ✅ Match Estratégia 1: IP recente + awaitingGuid + verificado (${player.steamId})`);
        }

        // Estratégia 2: Buscar qualquer verificado com esse IP
        if (!player) {
            player = await db.collection('players').findOne({
                lastIp: playerIp,
                verified: true,
                launcherVerified: true,
                $or: [
                    { guid: "pending" },
                    { guid: { $exists: false } }
                ]
            });

            if (player) {
                console.log(`   ✅ Match Estratégia 2: IP + verificado`);
            }
        }

        // Estratégia 3: Buscar por nickname (se configurado)
        if (!player) {
            player = await db.collection('players').findOne({
                nickname: inGameName,
                verified: true,
                launcherVerified: true,
                $or: [
                    { guid: "pending" },
                    { guid: { $exists: false } }
                ]
            });

            if (player) {
                console.log(`   ✅ Match Estratégia 3: Nickname correspondente`);
            }
        }

        // Estratégia 4: Buscar por HWID (caso IP dinâmico)
        if (!player) {
            const recentPlayers = await db.collection('players').find({
                lastLauncherCheck: { $gte: new Date(Date.now() - 30 * 60 * 1000) },
                verified: true,
                launcherVerified: true,
                awaitingGuid: true
            }).sort({ lastLauncherCheck: -1 }).toArray();

            if (recentPlayers.length === 1) {
                player = recentPlayers[0];
                console.log(`   ✅ Match Estratégia 4: Único player aguardando GUID (30min) - ${player.steamId}`);
            } else if (recentPlayers.length > 1) {
                console.log(`   ⚠️ Múltiplos players aguardando GUID (${recentPlayers.length}), ignorando Estratégia 4`);
                console.log(`      Players: ${recentPlayers.map(p => p.steamId).join(', ')}`);
            }
        }

        if (player) {
            // ATUALIZAR GUID E NAME
            await db.collection('players').updateOne(
                { steamId: player.steamId },
                {
                    $set: {
                        guid: guid,
                        name: inGameName, // Nome in-game atual
                        guidUpdatedAt: new Date(),
                        guidSource: 'be_log',
                        lastSeenInGame: new Date(),
                        awaitingGuid: false
                    }
                }
            );

            console.log(`   ✅ GUID MAPEADO: ${player.steamId} → ${guid}`);
            console.log(`   📛 In-Game Name: ${inGameName}`);

            // Verificar se está COMPLETO
            const isFullyVerified = player.verified && player.launcherVerified;

            if (isFullyVerified && !player.webhookSent) {
                await sendCompleteVerificationWebhook(player, guid);

                addToWhitelist(player.steamId, player.discordTag || inGameName);

                // ✅ DAR CARGO VERIFICADO NO DISCORD
                await giveVerifiedRole(player.discordId);

                await db.collection('players').updateOne(
                    { steamId: player.steamId },
                    { $set: { webhookSent: true, webhookSentAt: new Date() } }
                );
            } else {
                // Apenas log no console (sem webhook para não poluir o canal)
                console.log(`   ℹ️ GUID atualizado mas verificação incompleta:`);
                console.log(`      - Discord: ${player.verified ? '✅' : '❌'}`);
                console.log(`      - Launcher: ${player.launcherVerified ? '✅' : '❌'}`);
                console.log(`      - Webhook já enviado: ${player.webhookSent ? 'Sim' : 'Não'}`);
            }

            await db.collection('unmapped_players').deleteOne({ guid: guid });

        } else {
            // Player entrou mas não encontrado nas estratégias
            // VERIFICAR SE JÁ TEM GUID NO BANCO (player já verificado completamente)
            const existingPlayer = await db.collection('players').findOne({ guid: guid });
            
            if (existingPlayer) {
                // Player já tem este GUID registrado - apenas atualizar lastSeenInGame
                await db.collection('players').updateOne(
                    { steamId: existingPlayer.steamId },
                    {
                        $set: {
                            name: inGameName,
                            lastSeenInGame: new Date()
                        }
                    }
                );
                
                console.log(`   ℹ️ Player já registrado: ${existingPlayer.steamId} (${inGameName})`);
                console.log(`      Apenas atualizando lastSeenInGame`);
            } else {
                // Player completamente desconhecido
                console.log(`   ⚠️ GUID não mapeado: ${inGameName} (${guid})`);
                console.log(`      Pode ser: IP mudou, não verificado, ou liberado manualmente`);
                
                // Salvar em unmapped_players para debug
                await db.collection('unmapped_players').updateOne(
                    { guid: guid },
                    {
                        $set: {
                            guid: guid,
                            inGameName: inGameName,
                            lastIp: playerIp,
                            lastSeen: new Date(),
                            source: 'be_log'
                        }
                    },
                    { upsert: true }
                );
            }
        }

    } catch (error) {
        console.error('Erro ao atualizar GUID:', error.message);
    }
}

async function sendCompleteVerificationWebhook(player, guid) {
    try {
        const webhookUrl = process.env.WEBHOOK_VERIFICATION || process.env.WEBHOOK_ADMIN;

        if (!webhookUrl) {
            console.warn('[WEBHOOK] WEBHOOK_VERIFICATION não configurado');
            return;
        }

        const webhookClient = new Discord.WebhookClient({ url: webhookUrl });
        
        // 🔄 BUSCAR DADOS ATUALIZADOS DO BANCO (pega kills, deaths, playTime, etc)
        const playerData = await db.collection('players').findOne({ steamId: player.steamId });
        if (!playerData) {
            console.error('[WEBHOOK] Player não encontrado no banco!');
            return;
        }
        
        const otherSteamIds = (playerData.knownSteamIds || []).filter(id => id !== playerData.steamId);
        const otherAccountsString = otherSteamIds.length > 0 
            ? otherSteamIds.map(id => `• \`${id}\``).join('\n')
            : 'Nenhuma';

        const macString = (playerData.macAddresses || []).map(mac => `\`${mac}\``).join(', ') || 'N/A';
        const diskString = (playerData.diskSerials || []).map(disk => `\`${disk}\``).join(', ') || 'N/A';

        // Usar playerData (do banco) em vez de player (do cache)
        const embed = new Discord.EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('🚀 VERIFICAÇÃO COMPLETA - Sistema de Segurança')
            .setDescription(`**Steam ID:** \`${playerData.steamId}\`\n**GUID:** \`${guid}\``)
            .addFields(
                { 
                    name: '👤 Informações do Jogador', 
                    value: `**Discord:** \`${playerData.discordTag || 'N/A'}\`\n**Steam:** \`${playerData.steamName || 'N/A'}\`\n**In-Game:** \`${playerData.name || 'undefined'}\``,
                    inline: false
                },
                { 
                    name: '🆔 Identificadores', 
                    value: `**Discord ID:** \`${playerData.discordId || 'N/A'}\`\n**Steam ID:** \`${playerData.steamId}\`\n**GUID DayZ:** \`${guid}\``,
                    inline: false
                },
                { 
                    name: '💻 Máquina', 
                    value: `**HWID:** \`${playerData.hardwareId || 'N/A'}\`\n**IP:** \`${playerData.lastIp || 'N/A'}\`\n**Nome do PC:** \`${playerData.machineName || 'N/A'}\``,
                    inline: false 
                },
                { 
                    name: '🔧 Hardware Detalhado', 
                    value: `**MAC Addresses:** ${macString}\n**GPU:** \`${playerData.gpuId || 'unknown'}\`\n**Motherboard:** \`${playerData.motherboardSerial || 'unknown'}\`\n**CPU ID:** \`${playerData.cpuId || 'unknown'}\``,
                    inline: false 
                },
                { 
                    name: '💾 Discos Rígidos', 
                    value: diskString,
                    inline: false 
                },
                {
                    name: '🎮 Informações de Jogo',
                    value: playerData.playTime > 0 || playerData.kills > 0 || playerData.deaths > 0
                        ? `**Kills:** ${playerData.kills || 0} | **Deaths:** ${playerData.deaths || 0}\n**Dinheiro:** $${playerData.money || 0}\n**Tempo Jogado:** ${Math.floor((playerData.playTime || 0) / 60)}h\n**Clã:** ${playerData.clanId || 'Nenhum'}`
                        : `⚠️ **Player verificado mas ainda não jogou no servidor**\n` +
                          `Os stats serão atualizados automaticamente quando o player entrar no jogo.\n` +
                          `**Dinheiro Inicial:** $${playerData.money || 10000}`,
                    inline: false
                },
                { 
                    name: '🔎 Outras Contas Steam', 
                    value: otherAccountsString,
                    inline: false 
                }
            )
            .setFooter({ text: 'Verificação via BEC Log' })
            .setTimestamp();
        
        await webhookClient.send({ embeds: [embed] });
        console.log(`[WEBHOOK COMPLETO] Enviado para ${playerData.steamId}`);
    } catch (error) {
        console.error('Erro ao enviar webhook completo:', error);
    }
}

async function processChatLine(line) {
    try {
        const chatMatch = line.match(/(\d{2}:\d{2}:\d{2}) : Global: (.+?): (.+)/);
        if (chatMatch) {
            const [, time, playerName, message] = chatMatch;
            
            await db.collection('chat_logs').insertOne({
                timestamp: new Date(),
                time: time,
                type: 'global',
                playerName: playerName,
                message: message
            });

            console.log(`${time} [CHAT] ${playerName}: ${message}`);

            const embed = new Discord.EmbedBuilder()
                .setColor('#3498db')
                .setTitle('💬 Chat Global')
                .setDescription(`**${playerName}:** ${message}`)
                .setTimestamp()
                .setFooter({ text: time });

            await sendWebhook(embed);
        }
    } catch (error) {
        console.error('Erro ao processar chat:', error.message);
    }
}

async function processErrorLine(line) {
    try {
        if (line.includes('Warning') || line.includes('Error') || line.includes('error')) {
            console.log(`[ERRO BEC] ${line}`);

            const embed = new Discord.EmbedBuilder()
                .setColor('#ff0000')
                .setTitle('❌ Erro BEC')
                .setDescription(`\`\`\`${line}\`\`\``)
                .setTimestamp();

            await sendWebhook(embed);
        }
    } catch (error) {
        console.error('Erro ao processar erro:', error.message);
    }
}

function watchFile(filepath, processor) {
    if (watchedFiles.has(filepath)) return;
    
    if (!fs.existsSync(filepath)) {
        console.log(`⏳ Aguardando: ${path.basename(filepath)}`);
        
        const checkInterval = setInterval(() => {
            if (fs.existsSync(filepath)) {
                clearInterval(checkInterval);
                watchFile(filepath, processor);
            }
        }, 5000);
        
        return;
    }

    try {
        const stats = fs.statSync(filepath);
        let lastPosition = stats.size;
        
        watchedFiles.set(filepath, lastPosition);
        console.log(`👁️ Monitorando: ${path.basename(filepath)}`);
        
        fs.watchFile(filepath, { interval: 1000 }, async (curr, prev) => {
            if (curr.size > lastPosition) {
                const stream = fs.createReadStream(filepath, {
                    start: lastPosition,
                    end: curr.size,
                    encoding: 'utf8'
                });

                const rl = readline.createInterface({
                    input: stream,
                    crlfDelay: Infinity
                });

                for await (const line of rl) {
                    const trimmed = line.trim();
                    if (trimmed && !trimmed.startsWith('\uFEFF')) {
                        await processor(trimmed);
                    }
                }

                lastPosition = curr.size;
                watchedFiles.set(filepath, lastPosition);
            }
        });
    } catch (error) {
        console.error(`Erro ao monitorar ${filepath}:`, error.message);
    }
}

async function start() {
    console.log('╔════════════════════════════════════════╗');
    console.log('║  BEC Log Monitor - Sistema Completo   ║');
    console.log('╚════════════════════════════════════════╝\n');

    await connectMongo();
    await initDiscordClient();
    initWebhook();
    
    const beLogFile = getTodayLogFile(BE_LOG_DIR, 'Be');
    watchFile(beLogFile, processBeLogLine);
    
    const chatLogFile = getTodayLogFile(CHAT_LOG_DIR, 'Chat');
    watchFile(chatLogFile, processChatLine);
    
    const errorLogFile = getTodayLogFile(ERROR_LOG_DIR, 'BecError');
    watchFile(errorLogFile, processErrorLine);
    
    console.log('\n✅ Monitor ativo e aguardando eventos...\n');
    
    setInterval(async () => {
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
        await db.collection('temp_connections').deleteMany({
            connectedAt: { $lt: fiveMinutesAgo }
        });
    }, 300000);
}

process.on('SIGINT', () => {
    console.log('\n⚠️ Encerrando...');
    watchedFiles.forEach((pos, file) => {
        fs.unwatchFile(file);
    });
    process.exit(0);
});

start().catch(console.error);