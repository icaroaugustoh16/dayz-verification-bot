// ================================================
// LEADERBOARD SYNC - Sincroniza stats do mod LeaderBoard
// ================================================
const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const { MongoClient } = require('mongodb');
require('dotenv').config();

// ========== CONFIGURAÇÃO ==========
const LEADERBOARD_PATH = process.env.LEADERBOARD_PATH || 'C:\\DayZServer1.28_TESTE\\DayZServerModded_TESTE\\Profiles\\_LeaderBoard';
const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017';
const DATABASE_NAME = process.env.DATABASE_NAME || 'dayz_server';

let db = null;

// ========== CONECTAR AO MONGODB ==========
async function connectMongo() {
    try {
        const client = new MongoClient(MONGO_URL);
        await client.connect();
        db = client.db(DATABASE_NAME);
        return db;
    } catch (error) {
        console.error('❌ LeaderBoard: Erro ao conectar MongoDB:', error);
        process.exit(1);
    }
}

// ========== PARSEAR ARQUIVO JSON DO LEADERBOARD ==========
function parseLeaderboardFile(filePath) {
    try {
        const fileName = path.basename(filePath);
        
        // Validar nome do arquivo (deve ter SteamID)
        if (fileName === 'Survivor-.json' || !fileName.match(/Survivor-\d+\.json/)) {
            console.warn(`⚠️ Arquivo com nome inválido ignorado: ${fileName}`);
            return null;
        }
        
        const data = fs.readFileSync(filePath, 'utf8');
        const stats = JSON.parse(data);
        
        // Validar campos obrigatórios
        if (!stats.UID || !stats.Name || stats.UID.length < 10) {
            console.warn(`⚠️ Arquivo com dados inválidos: ${fileName} (UID: ${stats.UID || 'vazio'})`);
            return null;
        }

        return {
            steamId: stats.UID,
            name: stats.Name,
            kills: parseInt(stats.Kills) || 0,
            deaths: parseInt(stats.Dead) || 0,
            kdRatio: parseFloat(stats.KDRatio) || 0,
            longestKill: parseInt(stats.LShoot) || 0,
            zombieKills: parseInt(stats.ZKills) || 0,
            playTime: parseInt(stats.PlayTime) || 0,
            oldName: stats.OldName || '',
            lastUpdate: new Date(),
            lastLogin: new Date() // Atualizado toda vez que o arquivo muda (jogador está jogando)
        };
    } catch (error) {
        console.error(`❌ Erro ao parsear ${path.basename(filePath)}:`, error.message);
        return null;
    }
}

// ========== ATUALIZAR PLAYER NO MONGODB ==========
async function updatePlayerStats(playerData) {
    try {
        const result = await db.collection('players').updateOne(
            { steamId: playerData.steamId },
            {
                $set: {
                    name: playerData.name,
                    kills: playerData.kills,
                    deaths: playerData.deaths,
                    kdRatio: playerData.kdRatio,
                    longestKill: playerData.longestKill,
                    zombieKills: playerData.zombieKills,
                    playTime: playerData.playTime,
                    lastUpdate: playerData.lastUpdate,
                    lastLogin: playerData.lastLogin // Marca como jogando agora
                },
                $setOnInsert: {
                    steamId: playerData.steamId,
                    verified: false,
                    money: 10000,
                    firstJoin: new Date()
                }
            },
            { upsert: true }
        );

        // Logs silenciosos (comentar linha abaixo para debug)
        // if (result.upsertedCount > 0) console.log(`[NEW] ${playerData.name}`);

        return true;
    } catch (error) {
        console.error(`❌ Erro ao atualizar ${playerData.name}:`, error.message);
        return false;
    }
}

// ========== SINCRONIZAR TODOS OS ARQUIVOS (INICIAL) ==========
async function syncAllPlayers() {
    try {
        if (!fs.existsSync(LEADERBOARD_PATH)) {
            console.error(`❌ Pasta não encontrada: ${LEADERBOARD_PATH}`);
            return;
        }

        const files = fs.readdirSync(LEADERBOARD_PATH)
            .filter(file => file.startsWith('Survivor-') && file.endsWith('.json'));

        for (const file of files) {
            const filePath = path.join(LEADERBOARD_PATH, file);
            const playerData = parseLeaderboardFile(filePath);

            if (playerData) {
                await updatePlayerStats(playerData);
            }

            // Delay para não sobrecarregar
            await new Promise(resolve => setTimeout(resolve, 50));
        }
    } catch (error) {
        console.error('❌ Erro na sincronização inicial:', error);
    }
}

// ========== MONITORAR MUDANÇAS EM TEMPO REAL ==========
function startWatcher() {
    const watcher = chokidar.watch(
        path.join(LEADERBOARD_PATH, 'Survivor-*.json'),
        {
            persistent: true,
            ignoreInitial: true, // Ignorar arquivos existentes (já sincronizados)
            awaitWriteFinish: {
                stabilityThreshold: 500, // Esperar 500ms após última escrita
                pollInterval: 100
            }
        }
    );

    // Arquivo criado ou modificado
    watcher.on('change', async (filePath) => {
        const fileName = path.basename(filePath);
        const playerData = parseLeaderboardFile(filePath);

        if (playerData) {
            await updatePlayerStats(playerData);
        }
    });

    // Arquivo novo
    watcher.on('add', async (filePath) => {
        const fileName = path.basename(filePath);
        console.log(`[NEW FILE] 📄 ${fileName}`);
        
        const playerData = parseLeaderboardFile(filePath);

        if (playerData) {
            await updatePlayerStats(playerData);
        }
    });

    // Erro no watcher
    watcher.on('error', (error) => {
        console.error('❌ Erro no file watcher:', error);
    });
}

// ========== INICIAR SISTEMA ==========
async function start() {
    // Validar path
    if (!fs.existsSync(LEADERBOARD_PATH)) {
        console.error(`❌ LeaderBoard: Pasta não encontrada: ${LEADERBOARD_PATH}`);
        process.exit(1);
    }

    // Conectar MongoDB
    await connectMongo();

    // Sincronizar arquivos existentes
    await syncAllPlayers();

    // Iniciar monitoramento
    startWatcher();

    const files = fs.readdirSync(LEADERBOARD_PATH).filter(f => f.endsWith('.json')).length;
    console.log(`✅ LeaderBoard: ${files} jogadores | Monitorando atualizações`);
}

// ========== INICIAR ==========
start().catch(error => {
    console.error('❌ Erro fatal:', error);
    process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n\n⏹️  Encerrando LeaderBoard Sync...');
    process.exit(0);
});
