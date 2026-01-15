// ============================================================================
// FIX-INDEXES.JS - Corrige índices do MongoDB para o novo sistema
// ============================================================================

require('dotenv').config();
const { MongoClient } = require('mongodb');

const config = {
    url: process.env.MONGO_URL || 'mongodb://localhost:27017',
    dbName: process.env.DATABASE_NAME || 'dayz_server'
};

async function fixIndexes() {
    let client;

    try {
        console.log('🔧 Conectando ao MongoDB...');
        client = await MongoClient.connect(config.url);
        const db = client.db(config.dbName);
        const playersCollection = db.collection('players');

        console.log('\n📋 Verificando índices existentes...');
        const existingIndexes = await playersCollection.indexes();

        console.log('\n📊 Índices encontrados:');
        existingIndexes.forEach(idx => {
            const uniqueStr = idx.unique ? ' [UNIQUE]' : '';
            console.log(`  - ${idx.name}${uniqueStr}: ${JSON.stringify(idx.key)}`);
        });

        // Verificar índice steamId
        const steamIdIndex = existingIndexes.find(idx => idx.name === 'steamId_1');

        if (steamIdIndex) {
            if (!steamIdIndex.unique) {
                console.log('\n⚠️ Índice steamId_1 existe mas NÃO é único');
                console.log('🔄 Removendo índice antigo...');
                await playersCollection.dropIndex('steamId_1');
                console.log('✅ Índice antigo removido');

                console.log('🔄 Criando índice único...');
                await playersCollection.createIndex({ steamId: 1 }, { unique: true });
                console.log('✅ Índice steamId único criado com sucesso!');
            } else {
                console.log('\n✅ Índice steamId_1 já está correto (único)');
            }
        } else {
            console.log('\n🔄 Criando índice steamId único...');
            await playersCollection.createIndex({ steamId: 1 }, { unique: true });
            console.log('✅ Índice steamId único criado!');
        }

        // Criar outros índices se não existirem
        console.log('\n🔄 Verificando outros índices...');

        const indexesToCreate = [
            { key: { knownSteamIds: 1 }, name: 'knownSteamIds_1' },
            { key: { hardwareId: 1 }, name: 'hardwareId_1' },
            { key: { discordId: 1 }, name: 'discordId_1' },
            { key: { verified: 1 }, name: 'verified_1' }
        ];

        for (const idx of indexesToCreate) {
            const exists = existingIndexes.find(e => e.name === idx.name);
            if (!exists) {
                console.log(`  📌 Criando índice: ${idx.name}...`);
                await playersCollection.createIndex(idx.key);
                console.log(`  ✅ ${idx.name} criado`);
            } else {
                console.log(`  ✅ ${idx.name} já existe`);
            }
        }

        console.log('\n📊 Índices finais:');
        const finalIndexes = await playersCollection.indexes();
        finalIndexes.forEach(idx => {
            const uniqueStr = idx.unique ? ' [UNIQUE]' : '';
            console.log(`  - ${idx.name}${uniqueStr}: ${JSON.stringify(idx.key)}`);
        });

        console.log('\n✅ Todos os índices estão corretos!');
        console.log('\n🎉 Correção concluída! Agora você pode iniciar o servidor com: npm run all');

    } catch (error) {
        console.error('\n❌ Erro ao corrigir índices:', error);
        process.exit(1);
    } finally {
        if (client) {
            await client.close();
        }
    }
}

// Executar
fixIndexes().catch(console.error);
