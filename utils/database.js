const { MongoClient } = require('mongodb');

let client = null;
let db = null;

/**
 * Conecta ao MongoDB com connection pooling
 * @param {string} url - URL de conexão do MongoDB
 * @param {string} dbName - Nome do banco de dados
 * @returns {object} - Instância do banco de dados
 */
async function connect(url, dbName) {
    if (db) {
        console.log('✅ Reutilizando conexão MongoDB existente');
        return db;
    }

    try {
        client = await MongoClient.connect(url, {
            maxPoolSize: 10,           // Máximo de conexões no pool
            minPoolSize: 2,            // Mínimo de conexões mantidas
            maxIdleTimeMS: 30000,      // Tempo máximo de conexão ociosa
            serverSelectionTimeoutMS: 5000,  // Timeout para seleção do servidor
            socketTimeoutMS: 45000,    // Timeout de socket
        });

        db = client.db(dbName);

        // Criar índices essenciais
        await createIndexes();

        console.log('✅ MongoDB conectado com connection pool');
        console.log(`   Pool: min=${client.options.minPoolSize}, max=${client.options.maxPoolSize}`);

        return db;
    } catch (error) {
        console.error('❌ Erro ao conectar MongoDB:', error.message);
        throw error;
    }
}

/**
 * Retorna a instância do banco de dados
 * @returns {object|null} - Instância do banco ou null
 */
function getDb() {
    if (!db) {
        console.warn('⚠️ Banco de dados não conectado');
    }
    return db;
}

/**
 * Cria índices essenciais para performance
 */
async function createIndexes() {
    if (!db) return;

    try {
        console.log('🔧 Criando índices do banco de dados...');

        // Índices da collection 'players'
        await db.collection('players').createIndex({ steamId: 1 }, { unique: true });
        await db.collection('players').createIndex({ discordId: 1 });
        await db.collection('players').createIndex({ guid: 1 });
        await db.collection('players').createIndex({ lastIp: 1 });
        await db.collection('players').createIndex({
            lastLauncherCheck: -1,
            awaitingGuid: 1
        });
        await db.collection('players').createIndex({ kills: -1 });
        await db.collection('players').createIndex({ money: -1 });
        await db.collection('players').createIndex({ playTime: -1 });

        // Índices da collection 'logs'
        await db.collection('logs').createIndex({
            type: 1,
            timestamp: -1
        });
        await db.collection('logs').createIndex({ steamId: 1 });
        await db.collection('logs').createIndex({ timestamp: -1 });

        // Índices da collection 'verification_codes'
        await db.collection('verification_codes').createIndex({ code: 1 }, { unique: true });
        await db.collection('verification_codes').createIndex(
            { createdAt: 1 },
            { expireAfterSeconds: 600 }  // TTL: 10 minutos
        );

        // Índices da collection 'warnings'
        await db.collection('warnings').createIndex({ userId: 1 });
        await db.collection('warnings').createIndex({ timestamp: -1 });

        // Índices da collection 'whitelist'
        await db.collection('whitelist').createIndex({ steamId: 1 }, { unique: true });

        // Índices da collection 'unmapped_players'
        await db.collection('unmapped_players').createIndex({ guid: 1 }, { unique: true });
        await db.collection('unmapped_players').createIndex({ lastSeen: -1 });

        // Índices da collection 'temp_connections'
        await db.collection('temp_connections').createIndex({ playerId: 1 });
        await db.collection('temp_connections').createIndex({ connectedAt: 1 });

        // Índices da collection 'error_logs'
        await db.collection('error_logs').createIndex({ timestamp: -1 });
        await db.collection('error_logs').createIndex({ context: 1 });

        // Índices da collection 'payments'
        await db.collection('payments').createIndex({ paymentId: 1 }, { unique: true });
        await db.collection('payments').createIndex({ userId: 1 });
        await db.collection('payments').createIndex({ steamId: 1 });
        await db.collection('payments').createIndex({ status: 1 });
        await db.collection('payments').createIndex({ createdAt: -1 });
        await db.collection('payments').createIndex({ 
            status: 1, 
            processed: 1 
        });

        // Índices da collection 'chargebacks'
        await db.collection('chargebacks').createIndex({ paymentId: 1 }, { unique: true });
        await db.collection('chargebacks').createIndex({ userId: 1 });
        await db.collection('chargebacks').createIndex({ steamId: 1 });
        await db.collection('chargebacks').createIndex({ status: 1 });
        await db.collection('chargebacks').createIndex({ detectedAt: -1 });

        // Índices da collection 'refund_requests'
        await db.collection('refund_requests').createIndex({ paymentId: 1 });
        await db.collection('refund_requests').createIndex({ userId: 1 });
        await db.collection('refund_requests').createIndex({ status: 1 });
        await db.collection('refund_requests').createIndex({ requestedAt: -1 });

        console.log('✅ Índices criados com sucesso');
    } catch (error) {
        // Ignorar erro de índice duplicado
        if (error.code === 85 || error.code === 11000) {
            console.log('✅ Índices já existem');
        } else {
            console.error('❌ Erro ao criar índices:', error.message);
        }
    }
}

/**
 * Fecha a conexão com o MongoDB
 */
async function close() {
    if (client) {
        await client.close();
        client = null;
        db = null;
        console.log('🔌 Conexão MongoDB fechada');
    }
}

/**
 * Verifica o estado da conexão
 * @returns {boolean} - true se conectado
 */
function isConnected() {
    return db !== null && client?.topology?.isConnected();
}

/**
 * Estatísticas da conexão
 * @returns {object} - Estatísticas do connection pool
 */
function getStats() {
    if (!client) {
        return { connected: false };
    }

    return {
        connected: isConnected(),
        poolSize: client.options.maxPoolSize,
        dbName: db?.databaseName
    };
}

// Handlers de eventos
process.on('SIGINT', async () => {
    console.log('\n⚠️ Recebido SIGINT, fechando conexões...');
    await close();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n⚠️ Recebido SIGTERM, fechando conexões...');
    await close();
    process.exit(0);
});

module.exports = {
    connect,
    getDb,
    close,
    isConnected,
    getStats,
    createIndexes
};
