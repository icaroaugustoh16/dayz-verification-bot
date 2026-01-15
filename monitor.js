const { EmbedBuilder, WebhookClient } = require('discord.js');
const { MongoClient } = require('mongodb');
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
    pollInterval: 10000 // Verificar a cada 10 segundos
};

// Webhooks Discord
const webhooks = {
    kills: config.webhooks.kills ? new WebhookClient({ url: config.webhooks.kills }) : null,
    logs: config.webhooks.logs ? new WebhookClient({ url: config.webhooks.logs }) : null,
    admin: config.webhooks.admin ? new WebhookClient({ url: config.webhooks.admin }) : null
};

let db;
let lastChecks = {
    kills: new Date(),
    connections: new Date(),
    admin: new Date(),
    economy: new Date(),
    suspicious: new Date()
};

// ==================== CACHE DE JOGADORES CONECTADOS ====================
// Cache para rastrear jogadores realmente conectados (evita spam de logs)
// Sincronizado com o banco MongoDB ao iniciar
const connectedPlayers = new Map(); // Map<steamId, { playerName, connectedAt }>

// Conectar MongoDB
async function connectMongo() {
    const client = await MongoClient.connect(config.mongo.url);
    db = client.db(config.mongo.dbName);
    console.log('✅ Monitor conectado ao MongoDB');

    // Sincronizar cache de jogadores conectados com MongoDB
    await syncConnectedPlayersCache();
}

// Sincronizar cache de conectados com MongoDB
async function syncConnectedPlayersCache() {
    try {
        const onlinePlayers = await db.collection('players').find({ online: true }).toArray();

        connectedPlayers.clear();
        for (const player of onlinePlayers) {
            if (player.steamId) {
                connectedPlayers.set(player.steamId, {
                    playerName: player.name || 'Desconhecido',
                    connectedAt: player.lastLogin || new Date()
                });
            }
        }

        console.log(`✅ Cache sincronizado: ${connectedPlayers.size} jogadores online`);
    } catch (error) {
        console.error('Erro ao sincronizar cache:', error.message);
    }
}

// ==================== MONITORES COM POLLING ====================

// Monitor de Kills (polling)
async function checkNewKills() {
    try {
        const newKills = await db.collection('logs').find({
            type: 'kill',
            timestamp: { $gt: lastChecks.kills }
        }).toArray();

        for (const kill of newKills) {
            const killEmbed = new EmbedBuilder()
                .setColor('#ff0000')
                .setTitle('💀 Kill Feed')
                .addFields(
                    { name: '🔫 Matador', value: kill.killer || 'Desconhecido', inline: true },
                    { name: '☠️ Vítima', value: kill.victim || 'Desconhecido', inline: true },
                    { name: '🔪 Arma', value: kill.weapon || 'N/A', inline: true },
                    { name: '📍 Local', value: `${kill.location?.x || 0}, ${kill.location?.y || 0}`, inline: true },
                    { name: '📏 Distância', value: `${kill.distance || 0}m`, inline: true },
                    { name: '⏰ Horário', value: new Date(kill.timestamp).toLocaleString('pt-BR'), inline: true }
                )
                .setTimestamp();

            if (webhooks.kills) {
                await webhooks.kills.send({ embeds: [killEmbed] });
            }

            // Atualizar estatísticas
            await db.collection('players').updateOne(
                { name: kill.killer },
                { $inc: { kills: 1 } },
                { upsert: true }
            );
            
            await db.collection('players').updateOne(
                { name: kill.victim },
                { $inc: { deaths: 1 } },
                { upsert: true }
            );
        }

        if (newKills.length > 0) {
            lastChecks.kills = new Date();
        }
    } catch (error) {
        console.error('Erro ao verificar kills:', error.message);
    }
}

// Monitor de Conexões (polling)
async function checkNewConnections() {
    try {
        const newConnections = await db.collection('logs').find({
            type: { $in: ['connect', 'disconnect'] },
            timestamp: { $gt: lastChecks.connections }
        }).toArray();

        for (const conn of newConnections) {
            const isConnect = conn.type === 'connect';
            const steamId = conn.steamId;

            // Verificar se já está conectado (evita spam de logs em respawn/morte)
            if (isConnect) {
                const isAlreadyConnected = connectedPlayers.has(steamId);

                if (isAlreadyConnected) {
                    console.log(`[MONITOR] ${conn.playerName} já está conectado - ignorando log duplicada`);
                    continue; // Pula esta conexão
                }

                // Adicionar ao cache
                connectedPlayers.set(steamId, {
                    playerName: conn.playerName || 'Desconhecido',
                    connectedAt: new Date(conn.timestamp)
                });
            } else {
                // Remover do cache ao desconectar
                const wasConnected = connectedPlayers.has(steamId);

                if (!wasConnected) {
                    console.log(`[MONITOR] ${conn.playerName} não estava no cache - ignorando log duplicada`);
                    continue; // Pula esta desconexão
                }

                connectedPlayers.delete(steamId);
            }

            const connectionEmbed = new EmbedBuilder()
                .setColor(isConnect ? '#00ff00' : '#ff9900')
                .setTitle(isConnect ? '🟢 Jogador Conectou' : '🔴 Jogador Desconectou')
                .addFields(
                    { name: '👤 Jogador', value: conn.playerName || 'Desconhecido', inline: true },
                    { name: '🆔 Steam ID', value: conn.steamId || 'N/A', inline: true },
                    { name: '⏰ Horário', value: new Date(conn.timestamp).toLocaleString('pt-BR'), inline: true }
                );

            if (isConnect) {
                const player = await db.collection('players').findOne({ steamId: conn.steamId });
                if (player) {
                    connectionEmbed.addFields(
                        { name: '⏱️ Tempo Total', value: `${Math.floor((player.playTime || 0) / 60)}h`, inline: true },
                        { name: '💀 Kills', value: `${player.kills || 0}`, inline: true },
                        { name: '💰 Dinheiro', value: `$${player.money || 0}`, inline: true }
                    );
                }
            }

            if (webhooks.logs) {
                await webhooks.logs.send({ embeds: [connectionEmbed] });
            }

            console.log(`[MONITOR] ${isConnect ? '🟢' : '🔴'} ${conn.playerName} - ${connectedPlayers.size} players online`);
        }

        if (newConnections.length > 0) {
            lastChecks.connections = new Date();
        }
    } catch (error) {
        console.error('Erro ao verificar conexões:', error.message);
    }
}

// Monitor de Ações Admin (polling)
async function checkAdminActions() {
    try {
        const newActions = await db.collection('logs').find({
            type: { $in: ['ban', 'kick', 'teleport', 'spawn_item', 'god_mode'] },
            timestamp: { $gt: lastChecks.admin }
        }).toArray();

        for (const action of newActions) {
            const adminEmbed = new EmbedBuilder()
                .setColor('#ff9900')
                .setTitle('⚠️ Ação de Admin')
                .addFields(
                    { name: '👮 Admin', value: action.adminName || 'Desconhecido', inline: true },
                    { name: '🎯 Ação', value: action.type.toUpperCase(), inline: true },
                    { name: '👤 Alvo', value: action.targetName || 'N/A', inline: true },
                    { name: '📝 Detalhes', value: action.details || 'Sem detalhes', inline: false },
                    { name: '⏰ Horário', value: new Date(action.timestamp).toLocaleString('pt-BR'), inline: true }
                )
                .setTimestamp();

            if (webhooks.admin) {
                await webhooks.admin.send({ embeds: [adminEmbed] });
            }
        }

        if (newActions.length > 0) {
            lastChecks.admin = new Date();
        }
    } catch (error) {
        console.error('Erro ao verificar ações admin:', error.message);
    }
}

// Monitor de Economia (polling)
async function checkBigTransactions() {
    try {
        const newTransactions = await db.collection('logs').find({
            type: 'transaction',
            amount: { $gte: 10000 },
            timestamp: { $gt: lastChecks.economy }
        }).toArray();

        for (const trans of newTransactions) {
            const economyEmbed = new EmbedBuilder()
                .setColor('#ffd700')
                .setTitle('💸 Transação Grande Detectada')
                .addFields(
                    { name: '👤 De', value: trans.from || 'Sistema', inline: true },
                    { name: '👤 Para', value: trans.to || 'Sistema', inline: true },
                    { name: '💰 Valor', value: `$${trans.amount}`, inline: true },
                    { name: '📝 Tipo', value: trans.transactionType || 'Transferência', inline: false },
                    { name: '⏰ Horário', value: new Date(trans.timestamp).toLocaleString('pt-BR'), inline: true }
                )
                .setTimestamp();

            if (webhooks.logs) {
                await webhooks.logs.send({ embeds: [economyEmbed] });
            }
        }

        if (newTransactions.length > 0) {
            lastChecks.economy = new Date();
        }
    } catch (error) {
        console.error('Erro ao verificar transações:', error.message);
    }
}

// Monitor de Atividades Suspeitas (polling)
async function checkSuspiciousActivity() {
    try {
        const suspicious = await db.collection('logs').find({
            suspicious: true,
            timestamp: { $gt: lastChecks.suspicious }
        }).toArray();

        for (const activity of suspicious) {
            const suspiciousEmbed = new EmbedBuilder()
                .setColor('#ff0000')
                .setTitle('🚨 ATIVIDADE SUSPEITA DETECTADA')
                .addFields(
                    { name: '👤 Jogador', value: activity.playerName || 'Desconhecido', inline: true },
                    { name: '🆔 Steam ID', value: activity.steamId || 'N/A', inline: true },
                    { name: '⚠️ Tipo', value: activity.suspicionType || 'Desconhecido', inline: true },
                    { name: '📝 Descrição', value: activity.description || 'Sem descrição', inline: false },
                    { name: '📊 Nível de Risco', value: activity.riskLevel || 'Médio', inline: true },
                    { name: '⏰ Horário', value: new Date(activity.timestamp).toLocaleString('pt-BR'), inline: true }
                )
                .setTimestamp();

            if (webhooks.admin) {
                await webhooks.admin.send({ 
                    content: '@here ATENÇÃO: Atividade suspeita detectada!',
                    embeds: [suspiciousEmbed] 
                });
            }

            await db.collection('suspicious_activities').insertOne({
                ...activity,
                timestamp: new Date(),
                reviewed: false
            });
        }

        if (suspicious.length > 0) {
            lastChecks.suspicious = new Date();
        }
    } catch (error) {
        console.error('Erro ao verificar atividades suspeitas:', error.message);
    }
}

// Monitor de Performance
let lastPerformanceCheck = Date.now();
async function checkServerPerformance() {
    try {
        const players = await db.collection('players').countDocuments({ online: true });
        const serverStats = await db.collection('server_stats').findOne({ current: true });

        if (serverStats) {
            const performanceEmbed = new EmbedBuilder()
                .setColor('#00ffff')
                .setTitle('📊 Status do Servidor')
                .addFields(
                    { name: '👥 Jogadores Online', value: `${players}/${serverStats.maxPlayers || 60}`, inline: true },
                    { name: '💻 CPU', value: `${serverStats.cpu || 0}%`, inline: true },
                    { name: '🧠 RAM', value: `${serverStats.ram || 0}%`, inline: true },
                    { name: '📡 FPS', value: `${serverStats.fps || 0}`, inline: true },
                    { name: '⏱️ Uptime', value: `${Math.floor((Date.now() - serverStats.startTime) / 3600000)}h`, inline: true },
                    { name: '🌐 Ping Médio', value: `${serverStats.avgPing || 0}ms`, inline: true }
                )
                .setTimestamp();

            if (serverStats.cpu > 90 || serverStats.ram > 90) {
                performanceEmbed.setColor('#ff0000');
                performanceEmbed.setTitle('🚨 ALERTA: Performance Crítica!');
                
                if (webhooks.admin) {
                    await webhooks.admin.send({ 
                        content: '@here Servidor com performance crítica!',
                        embeds: [performanceEmbed] 
                    });
                }
            } else if (webhooks.logs && Date.now() - lastPerformanceCheck > 1800000) {
                await webhooks.logs.send({ embeds: [performanceEmbed] });
                lastPerformanceCheck = Date.now();
            }
        }
    } catch (error) {
        console.error('Erro ao verificar performance:', error.message);
    }
}

// Relatório Diário
async function sendDailyReport() {
    console.log('📋 Gerando relatório diário...');
    
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    try {
        const kills = await db.collection('logs').countDocuments({
            type: 'kill',
            timestamp: { $gte: yesterday, $lt: today }
        });

        const uniquePlayers = await db.collection('logs').distinct('steamId', {
            type: 'connect',
            timestamp: { $gte: yesterday, $lt: today }
        });

        const newPlayers = await db.collection('players').countDocuments({
            firstJoin: { $gte: yesterday, $lt: today }
        });

        const topKiller = await db.collection('logs').aggregate([
            { $match: { type: 'kill', timestamp: { $gte: yesterday, $lt: today } } },
            { $group: { _id: '$killer', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 1 }
        ]).toArray();

        const reportEmbed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('📊 Relatório Diário do Servidor')
            .setDescription(`Estatísticas de ${yesterday.toLocaleDateString('pt-BR')}`)
            .addFields(
                { name: '👥 Jogadores Únicos', value: `${uniquePlayers.length}`, inline: true },
                { name: '🆕 Novos Jogadores', value: `${newPlayers}`, inline: true },
                { name: '💀 Total de Kills', value: `${kills}`, inline: true },
                { name: '🏆 Top Killer', value: topKiller[0] ? `${topKiller[0]._id} (${topKiller[0].count} kills)` : 'N/A', inline: false }
            )
            .setFooter({ text: 'Relatório gerado automaticamente' })
            .setTimestamp();

        if (webhooks.logs) {
            await webhooks.logs.send({ embeds: [reportEmbed] });
        }
    } catch (error) {
        console.error('Erro ao gerar relatório diário:', error);
    }
}

function scheduleDailyReport() {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    const msUntilMidnight = midnight.getTime() - now.getTime();

    setTimeout(() => {
        sendDailyReport();
        setInterval(sendDailyReport, 86400000);
    }, msUntilMidnight);

    console.log(`📅 Relatório diário agendado para ${midnight.toLocaleString('pt-BR')}`);
}

// Avisos de Reinício
async function scheduleRestartWarnings(restartTimes = ['12:00', '00:00']) {
    console.log('⏰ Avisos de reinício configurados...');
    
    restartTimes.forEach(time => {
        const [hours, minutes] = time.split(':');
        
        scheduleAt(parseInt(hours), parseInt(minutes) - 30, async () => {
            const warningEmbed = new EmbedBuilder()
                .setColor('#ff9900')
                .setTitle('⚠️ Aviso de Reinício')
                .setDescription(`O servidor será reiniciado em **30 minutos** (às ${time})!`)
                .addFields(
                    { name: '💾', value: 'Guarde seus itens em local seguro' },
                    { name: '🏃', value: 'Procure um lugar seguro para deslogar' }
                )
                .setTimestamp();

            if (webhooks.logs) {
                await webhooks.logs.send({ content: '@everyone', embeds: [warningEmbed] });
            }
        });

        scheduleAt(parseInt(hours), parseInt(minutes) - 5, async () => {
            const warningEmbed = new EmbedBuilder()
                .setColor('#ff0000')
                .setTitle('🚨 REINÍCIO IMINENTE')
                .setDescription(`O servidor será reiniciado em **5 minutos**!`)
                .setTimestamp();

            if (webhooks.logs) {
                await webhooks.logs.send({ content: '@everyone', embeds: [warningEmbed] });
            }
        });
    });
}

function scheduleAt(hours, minutes, callback) {
    const now = new Date();
    const scheduled = new Date(now);
    scheduled.setHours(hours, minutes, 0, 0);

    if (scheduled <= now) {
        scheduled.setDate(scheduled.getDate() + 1);
    }

    const msUntilScheduled = scheduled.getTime() - now.getTime();

    setTimeout(() => {
        callback();
        setInterval(callback, 86400000);
    }, msUntilScheduled);
}

// Inicialização
async function startMonitoring() {
    console.log('╔════════════════════════════════════════╗');
    console.log('║   🎮 DayZ Discord Monitor (Polling)   ║');
    console.log('╚════════════════════════════════════════╝\n');
    
    await connectMongo();
    
    console.log('⚙️ Iniciando monitores com polling...\n');
    console.log(`⏱️ Intervalo de verificação: ${config.pollInterval / 1000}s\n`);
    
    // Iniciar polling loops
    setInterval(checkNewKills, config.pollInterval);
    setInterval(checkNewConnections, config.pollInterval);
    setInterval(checkAdminActions, config.pollInterval);
    setInterval(checkBigTransactions, config.pollInterval);
    setInterval(checkSuspiciousActivity, config.pollInterval);
    setInterval(checkServerPerformance, 60000); // A cada 1 minuto
    
    scheduleDailyReport();
    await scheduleRestartWarnings(['12:00', '00:00']);
    
    console.log('╔════════════════════════════════════════╗');
    console.log('║  ✅ TODOS OS MONITORES ATIVOS!        ║');
    console.log('╚════════════════════════════════════════╝\n');
    
    console.log('📊 Monitores ativos (Polling Mode):');
    console.log('  ✓ Kill Feed');
    console.log('  ✓ Conexões/Desconexões');
    console.log('  ✓ Ações de Admin');
    console.log('  ✓ Transações de Economia');
    console.log('  ✓ Atividades Suspeitas');
    console.log('  ✓ Performance do Servidor\n');
}

process.on('unhandledRejection', (error) => {
    console.error('❌ Erro não tratado:', error.message);
});

process.on('SIGINT', () => {
    console.log('\n⚠️ Encerrando monitores...');
    process.exit(0);
});

startMonitoring().catch((error) => {
    console.error('❌ Erro fatal:', error);
    process.exit(1);
});