const { EmbedBuilder, WebhookClient } = require('discord.js');
const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { addToWhitelist } = require('./utils/whitelist.js');
require('dotenv').config();

// Configuração
const config = {
    webhooks: {
        kills: process.env.WEBHOOK_KILLS,
        logs: process.env.WEBHOOK_LOGS,
        admin: process.env.WEBHOOK_ADMIN
    },
    mongo: {
        url: process.env.MONGO_URL || 'mongodb://localhost:27017',
        dbName: process.env.DATABASE_NAME || 'dayz_server'
    },
    paths: {
        codeLockLogs: process.env.CODELOCK_LOGS_PATH || 'C:/DayZServer1.28_TESTE/DayZServerModded_TESTE/Profiles/CodeLock/Logs',
        breachingLogs: process.env.BREACHING_LOGS_PATH || 'C:/DayZServer1.28_TESTE/DayZServerModded_TESTE/Profiles/BreachingCharge/logs',
        whitelist: process.env.WHITELIST_PATH || 'C:/DayZServer1.28_TESTE/DayZServerModded_TESTE/whitelist.txt'
    },
    checkInterval: 5000
};

const webhooks = {
    kills: config.webhooks.kills ? new WebhookClient({ url: config.webhooks.kills }) : null,
    logs: config.webhooks.logs ? new WebhookClient({ url: config.webhooks.logs }) : null,
    admin: config.webhooks.admin ? new WebhookClient({ url: config.webhooks.admin }) : null
};

let db;
let lastPositions = {
    adminLog: 0,
    accessLog: 0,
    raidLog: 0,
    breachingLog: 0
};

let watchedFiles = new Map(); // Track watched files with their last positions
let logFileCheckers = new Map(); // Store intervals that check for new log files

async function connectMongo() {
    const client = await MongoClient.connect(config.mongo.url);
    db = client.db(config.mongo.dbName);
    console.log('✅ Parser conectado ao MongoDB');
}

// ==================== FILE WATCHING (BEC LOGIC) ====================

function watchFile(filepath, processor, logName) {
    if (watchedFiles.has(filepath)) return;

    if (!fs.existsSync(filepath)) {
        console.log(`⏳ Aguardando: ${path.basename(filepath)} (${logName})`);

        const checkInterval = setInterval(() => {
            if (fs.existsSync(filepath)) {
                clearInterval(checkInterval);
                watchFile(filepath, processor, logName);
            }
        }, 5000);

        return;
    }

    try {
        const stats = fs.statSync(filepath);
        let lastPosition = stats.size;

        watchedFiles.set(filepath, lastPosition);
        console.log(`👁️ Monitorando: ${path.basename(filepath)} (${logName}) - Tamanho inicial: ${stats.size} bytes`);

        fs.watchFile(filepath, { interval: 1000 }, async (curr, prev) => {
            if (curr.size > lastPosition) {
                console.log(`[${logName}] 📝 Novas linhas detectadas! Tamanho: ${lastPosition} → ${curr.size}`);

                const stream = fs.createReadStream(filepath, {
                    start: lastPosition,
                    end: curr.size,
                    encoding: 'utf8'
                });

                const rl = readline.createInterface({
                    input: stream,
                    crlfDelay: Infinity
                });

                let lineCount = 0;
                for await (const line of rl) {
                    const trimmed = line.trim();
                    if (trimmed && !trimmed.startsWith('\uFEFF')) {
                        lineCount++;
                        await processor(trimmed);
                    }
                }

                console.log(`[${logName}] ✅ Processadas ${lineCount} linhas`);
                lastPosition = curr.size;
                watchedFiles.set(filepath, lastPosition);
            }
        });
    } catch (error) {
        console.error(`Erro ao monitorar ${filepath}:`, error.message);
    }
}

function getLatestLogFile(dir, extension = '.log', prefix = '') {
    if (!fs.existsSync(dir)) {
        return null;
    }

    const logFiles = fs.readdirSync(dir)
        .filter(f => {
            if (prefix) {
                return f.startsWith(prefix) && f.endsWith(extension);
            }
            return f.endsWith(extension);
        })
        .map(f => {
            const fullPath = path.join(dir, f);
            return {
                name: f,
                fullPath: fullPath,
                mtime: fs.statSync(fullPath).mtime
            };
        })
        .sort((a, b) => b.mtime - a.mtime); // Ordena por data de modificação (mais recente primeiro)

    return logFiles.length > 0 ? logFiles[0].fullPath : null;
}

// Monitora diretório e troca automaticamente para arquivo mais recente quando detecta mudança
function watchLatestLogFile(dir, extension, prefix, processor, logName) {
    console.log(`[${logName}] 🔍 Procurando arquivos em: ${dir}`);
    console.log(`[${logName}] 🔍 Filtros: extensão="${extension}" prefixo="${prefix}"`);

    let currentFile = getLatestLogFile(dir, extension, prefix);

    if (currentFile) {
        console.log(`[${logName}] ✅ Arquivo encontrado: ${path.basename(currentFile)}`);
        const stats = fs.statSync(currentFile);
        console.log(`[${logName}] 📊 Tamanho: ${stats.size} bytes, Modificado: ${stats.mtime}`);
        watchFile(currentFile, processor, logName);
    } else {
        console.log(`[${logName}] ❌ Nenhum arquivo encontrado em ${dir}`);
    }

    // Verifica a cada 10 segundos se um novo arquivo foi criado
    const checkInterval = setInterval(() => {
        const latestFile = getLatestLogFile(dir, extension, prefix);

        if (latestFile && latestFile !== currentFile) {
            console.log(`\n[${logName}] 🔄 NOVO ARQUIVO DETECTADO!`);
            console.log(`[${logName}] Anterior: ${currentFile ? path.basename(currentFile) : 'nenhum'}`);
            console.log(`[${logName}] Novo: ${path.basename(latestFile)}`);

            // Para de monitorar o arquivo antigo
            if (currentFile && watchedFiles.has(currentFile)) {
                fs.unwatchFile(currentFile);
                watchedFiles.delete(currentFile);
            }

            // Começa a monitorar o novo arquivo
            currentFile = latestFile;
            watchFile(currentFile, processor, logName);
        }
    }, 10000); // Verifica a cada 10 segundos

    logFileCheckers.set(logName, checkInterval);
}

// ==================== PARSERS DE LOGS ====================

function parseAdminLog() {
    const adminPath = path.join(config.paths.codeLockLogs, 'Admin');
    
    if (!fs.existsSync(adminPath)) {
        return;
    }
    
    const logFiles = fs.readdirSync(adminPath)
        .filter(f => f.endsWith('.log'))
        .sort()
        .reverse();

    if (logFiles.length === 0) return;

    const latestLog = path.join(adminPath, logFiles[0]);
    const content = fs.readFileSync(latestLog, 'utf8');
    const lines = content.split('\n');

    for (let i = lastPositions.adminLog; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line || line.includes('New Admin Log File') || line.includes('Log file reloaded')) continue;

        const joinMatch = line.match(/\[(\d+:\d+:\d+)\] Admin \((.+?), (\d+)\) joined the server!/);
        if (joinMatch) {
            const [, time, name, steamId] = joinMatch;
            sendAdminJoin(name, steamId, time);
            savePlayerConnect(name, steamId, true);
        }
    }

    lastPositions.adminLog = lines.length;
}

function parseRaidLog() {
    const raidPath = path.join(config.paths.codeLockLogs, 'Raid');
    
    if (!fs.existsSync(raidPath)) {
        return;
    }
    
    const logFiles = fs.readdirSync(raidPath)
        .filter(f => f.endsWith('.log'))
        .sort()
        .reverse();

    if (logFiles.length === 0) return;

    const latestLog = path.join(raidPath, logFiles[0]);
    const content = fs.readFileSync(latestLog, 'utf8');
    const lines = content.split('\n');

    for (let i = lastPositions.raidLog; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line || line.includes('New Raid Log File') || line.includes('Log file reloaded')) continue;

        const raidMatch = line.match(/\[(\d+:\d+:\d+)\] Player \((.+?), (\d+)\).*is raiding lock! CodeLock HP: (\d+) Damage Done: (\d+)/);
        if (raidMatch) {
            const [, time, name, steamId, hp, damage] = raidMatch;
            sendRaidAlert(name, steamId, hp, damage, time);
        }

        const successMatch = line.match(/\[(\d+:\d+:\d+)\] Player \((.+?), (\d+)\).*successfully raided lock!/);
        if (successMatch) {
            const [, time, name, steamId] = successMatch;
            sendRaidSuccess(name, steamId, time);
        }
    }

    lastPositions.raidLog = lines.length;
}

function parseAccessLog() {
    const accessPath = path.join(config.paths.codeLockLogs, 'Access');
    
    if (!fs.existsSync(accessPath)) {
        return;
    }
    
    const logFiles = fs.readdirSync(accessPath)
        .filter(f => f.endsWith('.log'))
        .sort()
        .reverse();

    if (logFiles.length === 0) return;

    const latestLog = path.join(accessPath, logFiles[0]);
    const content = fs.readFileSync(latestLog, 'utf8');
    const lines = content.split('\n');

    for (let i = lastPositions.accessLog; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line || line.includes('New Access Log File') || line.includes('Log file reloaded')) continue;

        const accessMatch = line.match(/\[(\d+:\d+:\d+)\] Player \((.+?), (\d+)\).*quick accessed a lock!/);
        if (accessMatch) {
            const [, , name, steamId] = accessMatch;
            incrementPlayerActivity(steamId);
        }

        const newLockMatch = line.match(/\[(\d+:\d+:\d+)\] Player \((.+?), (\d+)\).*set a new passcode on lock!/);
        if (newLockMatch) {
            const [, time, name, steamId] = newLockMatch;
            sendLockCreated(name, steamId, time);
        }

        const removeLockMatch = line.match(/\[(\d+:\d+:\d+)\] Player \((.+?), (\d+)\).*removed a lock!/);
        if (removeLockMatch) {
            const [, time, name, steamId] = removeLockMatch;
            sendLockRemoved(name, steamId, time);
        }
    }

    lastPositions.accessLog = lines.length;
}

// ==================== ENVIAR MENSAGENS DISCORD ====================

async function sendBreachingAlert(type, title, playerName, steamId, target, timestamp, damage = null) {
    const colors = {
        'PLACED': '#ffaa00',
        'ARMED': '#ff6600',
        'EXPLODED': '#ff0000',
        'DESTROYED': '#990000',
        'DEFUSED': '#00ff00'
    };

    const emojis = {
        'PLACED': '📦',
        'ARMED': '⏰',
        'EXPLODED': '💥',
        'DESTROYED': '💀',
        'DEFUSED': '✅'
    };

    const fields = [
        { name: '👤 Jogador', value: playerName, inline: true },
        { name: '🆔 Steam ID', value: `\`${steamId}\``, inline: true },
        { name: '🕐 Horário', value: timestamp, inline: true },
        { name: '🎯 Alvo', value: target, inline: false }
    ];

    if (damage) {
        fields.push({ name: '💢 Dano', value: damage, inline: true });
    }

    const embed = new EmbedBuilder()
        .setColor(colors[type] || '#ff9900')
        .setTitle(`${emojis[type] || '💣'} ${title}`)
        .addFields(fields)
        .setTimestamp()
        .setFooter({ text: 'Breaching Charge System' });

    if (webhooks.logs) {
        await webhooks.logs.send({ embeds: [embed] });
    }

    // Salvar no banco
    try {
        await db.collection('logs').insertOne({
            type: 'breaching_charge',
            action: type.toLowerCase(),
            playerName: playerName,
            steamId: steamId,
            target: target,
            damage: damage ? parseInt(damage) : null,
            timestamp: new Date(),
            logTime: timestamp
        });
    } catch (error) {
        console.error('Erro ao salvar log breaching:', error.message);
    }
}

async function sendAdminJoin(name, steamId, time) {
    const embed = new EmbedBuilder()
        .setColor('#ff9900')
        .setTitle('👮 Admin Conectou')
        .addFields(
            { name: 'Admin', value: name, inline: true },
            { name: 'Steam ID', value: steamId, inline: true },
            { name: 'Horário', value: time, inline: true }
        )
        .setTimestamp();

    if (webhooks.admin) {
        await webhooks.admin.send({ embeds: [embed] });
    }
}

async function sendRaidAlert(name, steamId, hp, damage, time) {
    const embed = new EmbedBuilder()
        .setColor('#ff6600')
        .setTitle('⚔️ Raid em Andamento')
        .addFields(
            { name: 'Jogador', value: name, inline: true },
            { name: 'HP Restante', value: hp, inline: true },
            { name: 'Dano', value: damage, inline: true }
        )
        .setTimestamp();

    if (webhooks.logs) {
        await webhooks.logs.send({ embeds: [embed] });
    }
}

async function sendRaidSuccess(name, steamId, time) {
    const embed = new EmbedBuilder()
        .setColor('#00ff00')
        .setTitle('✅ Raid Completo')
        .setDescription(`**${name}** conseguiu raidar uma base!`)
        .addFields(
            { name: 'Steam ID', value: steamId, inline: true },
            { name: 'Horário', value: time, inline: true }
        )
        .setTimestamp();

    if (webhooks.logs) {
        await webhooks.logs.send({ content: '@here', embeds: [embed] });
    }
}

async function sendLockCreated(name, steamId, time) {
    const embed = new EmbedBuilder()
        .setColor('#00ff00')
        .setTitle('🔒 Novo Cadeado Criado')
        .addFields(
            { name: 'Jogador', value: name, inline: true },
            { name: 'Steam ID', value: steamId, inline: true },
            { name: 'Horário', value: time, inline: true }
        )
        .setTimestamp();

    if (webhooks.logs) {
        await webhooks.logs.send({ embeds: [embed] });
    }
}

async function sendLockRemoved(name, steamId, time) {
    const embed = new EmbedBuilder()
        .setColor('#ff9900')
        .setTitle('🔓 Cadeado Removido')
        .addFields(
            { name: 'Jogador', value: name, inline: true },
            { name: 'Steam ID', value: steamId, inline: true },
            { name: 'Horário', value: time, inline: true }
        )
        .setTimestamp();

    if (webhooks.logs) {
        await webhooks.logs.send({ embeds: [embed] });
    }
}

// ==================== SALVAR DADOS ====================

async function savePlayerConnect(name, steamId, isAdmin = false) {
    await db.collection('players').updateOne(
        { steamId },
        {
            $set: {
                name,
                online: true,
                isAdmin,
                lastLogin: new Date()
            },
            $inc: { totalConnections: 1 },
            $setOnInsert: {
                kills: 0,
                deaths: 0,
                money: 10000,
                playTime: 0
            }
        },
        { upsert: true }
    );

    await db.collection('logs').insertOne({
        type: 'connect',
        playerName: name,
        steamId,
        isAdmin,
        timestamp: new Date()
    });
}

async function incrementPlayerActivity(steamId) {
    await db.collection('players').updateOne(
        { steamId },
        { $inc: { lockAccesses: 1 } }
    );
}

// ==================== LOOP PRINCIPAL ====================

async function startParsing() {
    console.log('╔═══════════════════════════════════════╗');
    console.log('║   🎮 DayZ Log Parser System           ║');
    console.log('╚═══════════════════════════════════════╝\n');

    await connectMongo();

    console.log('📂 Monitorando logs:\n');
    console.log(`  ✓ CodeLock Admin: ${path.join(config.paths.codeLockLogs, 'Admin')}`);
    console.log(`  ✓ CodeLock Raid: ${path.join(config.paths.codeLockLogs, 'Raid')}`);
    console.log(`  ✓ CodeLock Access: ${path.join(config.paths.codeLockLogs, 'Access')}`);
    console.log(`  ✓ Breaching Charge: ${config.paths.breachingLogs}\n`);

    console.log('🔍 DEBUG - Webhooks configurados:');
    console.log(`  Kills: ${webhooks.kills ? '✅ Configurado' : '❌ NÃO configurado'}`);
    console.log(`  Logs: ${webhooks.logs ? '✅ Configurado' : '❌ NÃO configurado'}`);
    console.log(`  Admin: ${webhooks.admin ? '✅ Configurado' : '❌ NÃO configurado'}\n`);

    // Setup file watching for Breaching Charge logs
    watchLatestLogFile(config.paths.breachingLogs, '.txt', '', processBreachingLogLine, 'Breaching Charge');

    // Keep polling for CodeLock logs (Admin, Raid, Access) since they have multiple files
    setInterval(async () => {
        try {
            parseAdminLog();
            parseRaidLog();
            parseAccessLog();
        } catch (error) {
            console.error('Erro no parsing CodeLock:', error);
        }
    }, config.checkInterval);

    console.log('\n✅ Parser ativo e monitorando logs em tempo real!\n');
}

// Process line by line for Breaching Charge
async function processBreachingLogLine(line) {
    try {
        if (!line) return;

        // PLACED - C4 colocado
        const placedMatch = line.match(/\[(\d+\/\d+\/\d+-\d+:\d+:\d+)\]\s+\[PLACED\].*Target:\s+(.+?)\s+\|\s+Player:\s+(.+?)\s+\[(\d+)\]/);
        if (placedMatch) {
            const [, timestamp, target, playerName, steamId] = placedMatch;
            await sendBreachingAlert('PLACED', 'C4 Colocado', playerName, steamId, target, timestamp);
            return;
        }

        // ARMED - C4 armado
        const armedMatch = line.match(/\[(\d+\/\d+\/\d+-\d+:\d+:\d+)\]\s+\[ARMED\].*Target:\s+(.+?)\s+\|\s+Player:\s+(.+?)\s+\[(\d+)\]/);
        if (armedMatch) {
            const [, timestamp, target, playerName, steamId] = armedMatch;
            await sendBreachingAlert('ARMED', 'C4 Armado', playerName, steamId, target, timestamp);
            return;
        }

        // EXPLODED - C4 explodiu
        const explodedMatch = line.match(/\[(\d+\/\d+\/\d+-\d+:\d+:\d+)\]\s+\[EXPLODED\].*Target:\s+(.+?),\s+Damage done:\s+(\d+)\s+\|\s+Player:\s+(.+?)\s+\[(\d+)\]/);
        if (explodedMatch) {
            const [, timestamp, target, damage, playerName, steamId] = explodedMatch;
            await sendBreachingAlert('EXPLODED', 'C4 Explodiu', playerName, steamId, target, timestamp, damage);
            return;
        }

        // DESTROYED - Alvo destruído
        const destroyedMatch = line.match(/\[(\d+\/\d+\/\d+-\d+:\d+:\d+)\]\s+\[DESTROYED\].*Target:\s+(.+?)\s+\|\s+Player:\s+(.+?)\s+\[(\d+)\]/);
        if (destroyedMatch) {
            const [, timestamp, target, playerName, steamId] = destroyedMatch;
            await sendBreachingAlert('DESTROYED', 'Alvo Destruído', playerName, steamId, target, timestamp);
            return;
        }

        // DEFUSED - C4 desarmado
        const defusedMatch = line.match(/\[(\d+\/\d+\/\d+-\d+:\d+:\d+)\]\s+\[DEFUSED\].*Target:\s+(.+?)\s+\|\s+Defusing Player:\s+(.+?)\s+\[(\d+)\]/);
        if (defusedMatch) {
            const [, timestamp, target, playerName, steamId] = defusedMatch;
            await sendBreachingAlert('DEFUSED', 'C4 Desarmado', playerName, steamId, target, timestamp);
            return;
        }
    } catch (error) {
        console.error('Erro ao processar linha Breaching:', error.message);
    }
}


module.exports = {
    startParsing
};

if (require.main === module) {
    startParsing().catch(console.error);
}