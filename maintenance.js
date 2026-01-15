// ==================== SCRIPTS DE MANUTENÇÃO ====================
// Arquivo: maintenance.js

const { MongoClient } = require('mongodb');
require('dotenv').config();

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017';
const DATABASE_NAME = process.env.DATABASE_NAME || 'dayz_server';

let db;

async function connect() {
    const client = await MongoClient.connect(MONGO_URL);
    db = client.db(DATABASE_NAME);
    console.log('✅ Conectado ao MongoDB\n');
}

// ==================== LIMPEZA DE DADOS ====================

// Limpar jogadores inativos (não conectam há mais de 90 dias)
async function cleanInactivePlayers() {
    console.log('🧹 Limpando jogadores inativos...');
    
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const result = await db.collection('players').deleteMany({
        lastLogin: { $lt: ninetyDaysAgo },
        playTime: { $lt: 3600 } // Menos de 1 hora jogada
    });

    console.log(`✅ ${result.deletedCount} jogadores inativos removidos\n`);
}

// Limpar logs antigos (mais de 30 dias)
async function cleanOldLogs() {
    console.log('🧹 Limpando logs antigos...');
    
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const result = await db.collection('logs').deleteMany({
        timestamp: { $lt: thirtyDaysAgo }
    });

    console.log(`✅ ${result.deletedCount} logs antigos removidos\n`);
}

// Limpar warns expirados (mais de 6 meses)
async function cleanExpiredWarnings() {
    console.log('🧹 Limpando warns expirados...');
    
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const result = await db.collection('warnings').deleteMany({
        timestamp: { $lt: sixMonthsAgo }
    });

    console.log(`✅ ${result.deletedCount} warns expirados removidos\n`);
}

// ==================== BACKUP ====================

async function createBackup() {
    console.log('💾 Criando backup...');
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = `backup_${timestamp}`;

    try {
        // Exportar coleções importantes
        const collections = ['players', 'logs', 'whitelist', 'warnings'];
        const backupData = {};

        for (const collectionName of collections) {
            const data = await db.collection(collectionName).find({}).toArray();
            backupData[collectionName] = data;
            console.log(`  📦 ${collectionName}: ${data.length} documentos`);
        }

        // Salvar informações do backup
        await db.collection('backups').insertOne({
            name: backupName,
            timestamp: new Date(),
            collections: Object.keys(backupData),
            totalDocuments: Object.values(backupData).reduce((acc, arr) => acc + arr.length, 0),
            size: JSON.stringify(backupData).length
        });

        console.log(`✅ Backup criado: ${backupName}\n`);
        return backupData;
    } catch (error) {
        console.error('❌ Erro ao criar backup:', error);
    }
}

// ==================== ESTATÍSTICAS ====================

async function generateStatistics() {
    console.log('📊 Gerando estatísticas do servidor...\n');

    // Total de jogadores registrados
    const totalPlayers = await db.collection('players').countDocuments();
    console.log(`👥 Total de jogadores: ${totalPlayers}`);

    // Jogadores online
    const onlinePlayers = await db.collection('players').countDocuments({ online: true });
    console.log(`🟢 Jogadores online: ${onlinePlayers}`);

    // Top 5 Killers
    const topKillers = await db.collection('players')
        .find({})
        .sort({ kills: -1 })
        .limit(5)
        .toArray();
    
    console.log('\n🏆 Top 5 Killers:');
    topKillers.forEach((player, i) => {
        console.log(`  ${i + 1}. ${player.name} - ${player.kills} kills`);
    });

    // Top 5 Mais Ricos
    const topRich = await db.collection('players')
        .find({})
        .sort({ money: -1 })
        .limit(5)
        .toArray();
    
    console.log('\n💰 Top 5 Mais Ricos:');
    topRich.forEach((player, i) => {
        console.log(`  ${i + 1}. ${player.name} - ${player.money}`);
    });

    // Top 5 Mais Tempo Jogado
    const topPlaytime = await db.collection('players')
        .find({})
        .sort({ playTime: -1 })
        .limit(5)
        .toArray();
    
    console.log('\n⏱️ Top 5 Tempo Jogado:');
    topPlaytime.forEach((player, i) => {
        const hours = Math.floor(player.playTime / 60);
        console.log(`  ${i + 1}. ${player.name} - ${hours}h`);
    });

    // Estatísticas gerais
    const totalKills = await db.collection('logs').countDocuments({ type: 'kill' });
    const totalConnections = await db.collection('logs').countDocuments({ type: 'connect' });
    
    console.log('\n📈 Estatísticas Gerais:');
    console.log(`  💀 Total de kills: ${totalKills}`);
    console.log(`  🔌 Total de conexões: ${totalConnections}`);
    
    // Warns ativos
    const activeWarnings = await db.collection('warnings').countDocuments();
    console.log(`  ⚠️ Warns ativos: ${activeWarnings}`);

    // Whitelist
    const whitelistCount = await db.collection('whitelist').countDocuments();
    console.log(`  📋 Jogadores na whitelist: ${whitelistCount}\n`);
}

// ==================== OTIMIZAÇÃO ====================

async function optimizeDatabase() {
    console.log('⚡ Otimizando banco de dados...\n');

    // Criar índices para melhor performance
    const indexes = [
        { collection: 'players', index: { steamId: 1 }, name: 'steamId_1' },
        { collection: 'players', index: { discordId: 1 }, name: 'discordId_1' },
        { collection: 'players', index: { kills: -1 }, name: 'kills_-1' },
        { collection: 'players', index: { money: -1 }, name: 'money_-1' },
        { collection: 'players', index: { playTime: -1 }, name: 'playTime_-1' },
        { collection: 'logs', index: { type: 1, timestamp: -1 }, name: 'type_1_timestamp_-1' },
        { collection: 'logs', index: { steamId: 1 }, name: 'steamId_1' },
        { collection: 'warnings', index: { userId: 1 }, name: 'userId_1' },
        { collection: 'whitelist', index: { steamId: 1 }, name: 'steamId_1' }
    ];

    for (const { collection, index, name } of indexes) {
        try {
            await db.collection(collection).createIndex(index, { name });
            console.log(`✅ Índice criado: ${collection}.${name}`);
        } catch (error) {
            if (error.code === 85) {
                console.log(`⚠️ Índice já existe: ${collection}.${name}`);
            } else {
                console.error(`❌ Erro ao criar índice ${collection}.${name}:`, error.message);
            }
        }
    }

    console.log('\n✅ Otimização concluída!\n');
}

// ==================== RESET DE ECONOMIA ====================

async function resetEconomy(confirm = false) {
    if (!confirm) {
        console.log('⚠️ ATENÇÃO: Este comando resetará toda a economia do servidor!');
        console.log('Execute novamente com resetEconomy(true) para confirmar.\n');
        return;
    }

    console.log('💸 Resetando economia...');

    await db.collection('players').updateMany(
        {},
        { $set: { money: 10000 } } // Valor inicial
    );

    console.log('✅ Economia resetada! Todos os jogadores agora têm $10.000\n');
}

// ==================== WIPE DE ESTATÍSTICAS ====================

async function wipeStatistics(confirm = false) {
    if (!confirm) {
        console.log('⚠️ ATENÇÃO: Este comando resetará todas as estatísticas (kills, deaths, etc)!');
        console.log('Execute novamente com wipeStatistics(true) para confirmar.\n');
        return;
    }

    console.log('📊 Wipando estatísticas...');

    await db.collection('players').updateMany(
        {},
        { 
            $set: { 
                kills: 0,
                deaths: 0,
                playTime: 0
            } 
        }
    );

    await db.collection('logs').deleteMany({ type: { $in: ['kill', 'death'] } });

    console.log('✅ Estatísticas wipadas!\n');
}

// ==================== VERIFICAR INTEGRIDADE ====================

async function checkIntegrity() {
    console.log('🔍 Verificando integridade do banco de dados...\n');

    // Verificar jogadores sem steamId
    const noSteamId = await db.collection('players').countDocuments({ 
        $or: [
            { steamId: { $exists: false } },
            { steamId: null },
            { steamId: '' }
        ]
    });
    
    if (noSteamId > 0) {
        console.log(`⚠️ ${noSteamId} jogadores sem Steam ID`);
    } else {
        console.log('✅ Todos os jogadores têm Steam ID');
    }

    // Verificar logs órfãos (sem referência a jogador)
    const orphanLogs = await db.collection('logs').countDocuments({
        type: 'kill',
        $or: [
            { killer: null },
            { victim: null }
        ]
    });
    
    if (orphanLogs > 0) {
        console.log(`⚠️ ${orphanLogs} logs de kill sem referência`);
    } else {
        console.log('✅ Todos os logs estão consistentes');
    }

    // Verificar warnings duplicados
    const duplicateWarnings = await db.collection('warnings').aggregate([
        { $group: { _id: { userId: '$userId', timestamp: '$timestamp' }, count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } }
    ]).toArray();
    
    if (duplicateWarnings.length > 0) {
        console.log(`⚠️ ${duplicateWarnings.length} warns duplicados encontrados`);
    } else {
        console.log('✅ Nenhum warn duplicado');
    }

    // Tamanho das coleções
    const stats = await db.stats();
    console.log(`\n💾 Tamanho do banco: ${(stats.dataSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`📦 Total de coleções: ${stats.collections}\n`);
}

// ==================== BUSCAR JOGADOR ====================

async function findPlayer(search) {
    console.log(`🔍 Buscando: ${search}\n`);

    // Buscar por Steam ID ou nome
    const player = await db.collection('players').findOne({
        $or: [
            { steamId: search },
            { name: { $regex: search, $options: 'i' } },
            { discordId: search }
        ]
    });

    if (!player) {
        console.log('❌ Jogador não encontrado\n');
        return;
    }

    console.log('✅ Jogador encontrado:');
    console.log(`  👤 Nome: ${player.name}`);
    console.log(`  🆔 Steam ID: ${player.steamId}`);
    console.log(`  💬 Discord ID: ${player.discordId || 'Não vinculado'}`);
    console.log(`  💀 K/D: ${player.kills}/${player.deaths} (${((player.kills || 0) / (player.deaths || 1)).toFixed(2)})`);
    console.log(`  💰 Dinheiro: ${player.money || 0}`);
    console.log(`  ⏱️ Tempo jogado: ${Math.floor((player.playTime || 0) / 60)}h`);
    console.log(`  📅 Último login: ${player.lastLogin ? new Date(player.lastLogin).toLocaleString('pt-BR') : 'Nunca'}`);
    console.log(`  🟢 Status: ${player.online ? 'Online' : 'Offline'}\n`);

    // Buscar warns do jogador
    const warnings = await db.collection('warnings').find({ 
        $or: [
            { userId: player.discordId },
            { steamId: player.steamId }
        ]
    }).toArray();

    if (warnings.length > 0) {
        console.log(`⚠️ Warns (${warnings.length}):`);
        warnings.forEach((warn, i) => {
            console.log(`  ${i + 1}. ${warn.reason} - ${new Date(warn.timestamp).toLocaleDateString('pt-BR')}`);
        });
        console.log('');
    }
}

// ==================== ADICIONAR DINHEIRO ====================

async function addMoney(steamId, amount) {
    console.log(`💰 Adicionando ${amount} ao jogador ${steamId}...`);

    const result = await db.collection('players').updateOne(
        { steamId },
        { $inc: { money: amount } }
    );

    if (result.matchedCount === 0) {
        console.log('❌ Jogador não encontrado\n');
        return;
    }

    const player = await db.collection('players').findOne({ steamId });
    console.log(`✅ Dinheiro atualizado! Novo saldo: ${player.money}\n`);

    // Registrar log
    await db.collection('logs').insertOne({
        type: 'admin_money',
        steamId,
        amount,
        newBalance: player.money,
        timestamp: new Date()
    });
}

// ==================== MENU INTERATIVO ====================

async function showMenu() {
    console.log('╔═══════════════════════════════════════╗');
    console.log('║  🛠️  MENU DE MANUTENÇÃO DayZ        ║');
    console.log('╚═══════════════════════════════════════╝\n');
    
    console.log('📊 ESTATÍSTICAS:');
    console.log('  1. generateStatistics()       - Ver estatísticas gerais');
    console.log('  2. checkIntegrity()           - Verificar integridade do BD');
    console.log('  3. findPlayer(\'steamId\')       - Buscar jogador\n');
    
    console.log('🧹 LIMPEZA:');
    console.log('  4. cleanInactivePlayers()     - Limpar jogadores inativos');
    console.log('  5. cleanOldLogs()             - Limpar logs antigos (30d+)');
    console.log('  6. cleanExpiredWarnings()     - Limpar warns expirados (6m+)\n');
    
    console.log('⚡ OTIMIZAÇÃO:');
    console.log('  7. optimizeDatabase()         - Criar índices e otimizar');
    console.log('  8. createBackup()             - Criar backup manual\n');
    
    console.log('💰 ECONOMIA:');
    console.log('  9. addMoney(steamId, valor)   - Adicionar dinheiro');
    console.log(' 10. resetEconomy(true)         - RESETAR economia (cuidado!)\n');
    
    console.log('🗑️ WIPE:');
    console.log(' 11. wipeStatistics(true)       - WIPAR estatísticas (cuidado!)\n');
    
    console.log('Digite o comando desejado no console Node.js\n');
}

// ==================== AUTO-MANUTENÇÃO ====================

async function scheduleMaintenance() {
    console.log('⏰ Agendando manutenção automática...\n');

    // Limpeza semanal (todo domingo às 03:00)
    const scheduleWeekly = () => {
        const now = new Date();
        const nextSunday = new Date(now);
        nextSunday.setDate(now.getDate() + (7 - now.getDay()));
        nextSunday.setHours(3, 0, 0, 0);

        const msUntil = nextSunday.getTime() - now.getTime();

        setTimeout(async () => {
            console.log('\n🧹 Iniciando manutenção automática semanal...');
            await cleanOldLogs();
            await cleanExpiredWarnings();
            await cleanInactivePlayers();
            await optimizeDatabase();
            console.log('✅ Manutenção semanal concluída!\n');

            scheduleWeekly(); // Reagendar
        }, msUntil);

        console.log(`📅 Próxima manutenção: ${nextSunday.toLocaleString('pt-BR')}`);
    };

    // Backup diário (todo dia às 02:00)
    const scheduleDaily = () => {
        const now = new Date();
        const tomorrow = new Date(now);
        tomorrow.setDate(now.getDate() + 1);
        tomorrow.setHours(2, 0, 0, 0);

        const msUntil = tomorrow.getTime() - now.getTime();

        setTimeout(async () => {
            console.log('\n💾 Criando backup automático diário...');
            await createBackup();
            console.log('✅ Backup diário concluído!\n');

            scheduleDaily(); // Reagendar
        }, msUntil);

        console.log(`📅 Próximo backup: ${tomorrow.toLocaleString('pt-BR')}\n`);
    };

    scheduleWeekly();
    scheduleDaily();
}

// ==================== EXECUÇÃO ====================

async function main() {
    await connect();
    await showMenu();
    await scheduleMaintenance();
    
    console.log('✅ Sistema de manutenção pronto!\n');
    console.log('💡 Dica: Use os comandos listados acima diretamente no console.\n');
}

// Permitir execução de funções via linha de comando
if (require.main === module) {
    main().catch(console.error);
}

// Exportar funções para uso em outros scripts
module.exports = {
    cleanInactivePlayers,
    cleanOldLogs,
    cleanExpiredWarnings,
    createBackup,
    generateStatistics,
    optimizeDatabase,
    resetEconomy,
    wipeStatistics,
    checkIntegrity,
    findPlayer,
    addMoney,
    scheduleMaintenance
};