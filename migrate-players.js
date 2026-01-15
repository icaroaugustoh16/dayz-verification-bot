// migrate-players.js - Script de migração para compatibilidade do novo sistema
const { MongoClient } = require('mongodb');
require('dotenv').config();

const config = {
    mongo: {
        url: process.env.MONGO_URL || 'mongodb://localhost:27017',
        dbName: process.env.DATABASE_NAME || 'dayz_server'
    }
};

async function migrate() {
    console.log('╔════════════════════════════════════════╗');
    console.log('║   Migração de Dados - Player Model    ║');
    console.log('╚════════════════════════════════════════╝\n');

    let client;

    try {
        // Conectar ao MongoDB
        console.log('📡 Conectando ao MongoDB...');
        client = await MongoClient.connect(config.mongo.url);
        const db = client.db(config.mongo.dbName);
        const playersCollection = db.collection('players');

        console.log('✅ Conectado!\n');

        // ========== PASSO 1: REMOVER ÍNDICES ANTIGOS PROBLEMÁTICOS ==========
        console.log('🗑️  Removendo índices antigos problemáticos...');

        try {
            // Listar todos os índices
            const indexes = await playersCollection.indexes();
            console.log(`   Índices atuais: ${indexes.map(i => i.name).join(', ')}`);

            // Tentar remover índice problemático se existir
            const problemIndexes = ['primarySteamId_1'];

            for (const indexName of problemIndexes) {
                const indexExists = indexes.find(i => i.name === indexName);
                if (indexExists) {
                    await playersCollection.dropIndex(indexName);
                    console.log(`   ✅ Índice '${indexName}' removido`);
                } else {
                    console.log(`   ℹ️  Índice '${indexName}' não existe (OK)`);
                }
            }
        } catch (error) {
            console.log(`   ⚠️  Aviso ao remover índices: ${error.message}`);
        }

        console.log('');

        // ========== PASSO 2: LIMPAR DOCUMENTOS PROBLEMÁTICOS ==========
        console.log('🧹 Limpando documentos null...');

        // Remover campo primarySteamId null (para evitar conflitos)
        const nullFixed = await playersCollection.updateMany(
            { primarySteamId: null },
            { $unset: { primarySteamId: "" } }
        );

        if (nullFixed.modifiedCount > 0) {
            console.log(`   ✅ Removido primarySteamId null de ${nullFixed.modifiedCount} documentos`);
        } else {
            console.log('   ℹ️  Nenhum documento com primarySteamId null');
        }

        console.log('');

        // ========== PASSO 3: MIGRAR DADOS ANTIGOS ==========
        console.log('🔄 Migrando dados antigos...');

        // Contar documentos sem primarySteamId
        const countMissing = await playersCollection.countDocuments({
            primarySteamId: { $exists: false },
            steamId: { $exists: true, $ne: null }
        });

        console.log(`   Documentos a migrar: ${countMissing}`);

        if (countMissing > 0) {
            // Atualizar documentos que têm steamId mas não primarySteamId
            const result = await playersCollection.updateMany(
                {
                    primarySteamId: { $exists: false },
                    steamId: { $exists: true, $ne: null }
                },
                [
                    {
                        $set: {
                            primarySteamId: '$steamId',
                            steamIds: {
                                $cond: {
                                    if: { $isArray: '$steamIds' },
                                    then: '$steamIds',
                                    else: ['$steamId']
                                }
                            }
                        }
                    }
                ]
            );

            console.log(`   ✅ Migrados: ${result.modifiedCount} documentos`);
        } else {
            console.log('   ℹ️  Nenhum documento precisa ser migrado');
        }

        console.log('');

        // ========== PASSO 4: CRIAR NOVOS ÍNDICES ==========
        console.log('📊 Criando novos índices...');

        // Índice único parcial para primarySteamId
        try {
            await playersCollection.createIndex(
                { primarySteamId: 1 },
                {
                    unique: true,
                    partialFilterExpression: {
                        primarySteamId: { $type: 'string' }
                    },
                    name: 'primarySteamId_unique_partial'
                }
            );
            console.log('   ✅ primarySteamId_unique_partial');
        } catch (error) {
            if (error.code === 85 || error.code === 86) {
                console.log('   ℹ️  primarySteamId_unique_partial já existe');
            } else {
                throw error;
            }
        }

        // Índices de compatibilidade
        await playersCollection.createIndex({ steamId: 1 });
        console.log('   ✅ steamId_1');

        await playersCollection.createIndex({ hardwareId: 1 });
        console.log('   ✅ hardwareId_1');

        await playersCollection.createIndex({ discordId: 1 });
        console.log('   ✅ discordId_1');

        await playersCollection.createIndex({ steamIds: 1 });
        console.log('   ✅ steamIds_1');

        console.log('');

        // ========== PASSO 5: VERIFICAR MIGRAÇÃO ==========
        console.log('🔍 Verificando migração...');

        const totalPlayers = await playersCollection.countDocuments();
        const withPrimarySteam = await playersCollection.countDocuments({
            primarySteamId: { $exists: true, $ne: null }
        });
        const withoutPrimarySteam = await playersCollection.countDocuments({
            $or: [
                { primarySteamId: { $exists: false } },
                { primarySteamId: null }
            ]
        });

        console.log(`   Total de players: ${totalPlayers}`);
        console.log(`   Com primarySteamId: ${withPrimarySteam}`);
        console.log(`   Sem primarySteamId: ${withoutPrimarySteam}`);

        if (withoutPrimarySteam > 0) {
            console.log('\n   ⚠️  AVISO: Ainda há documentos sem primarySteamId');
            console.log('   Esses documentos podem ser antigos ou corrompidos');

            // Mostrar exemplos
            const examples = await playersCollection
                .find({
                    $or: [
                        { primarySteamId: { $exists: false } },
                        { primarySteamId: null }
                    ]
                })
                .limit(5)
                .toArray();

            console.log('\n   Exemplos:');
            examples.forEach((doc, i) => {
                console.log(`   ${i + 1}. steamId: ${doc.steamId || 'null'}, discordId: ${doc.discordId || 'null'}, name: ${doc.name || 'null'}`);
            });
        }

        console.log('\n╔════════════════════════════════════════╗');
        console.log('║        ✅ Migração Concluída!         ║');
        console.log('╚════════════════════════════════════════╝\n');

        console.log('✅ Agora você pode iniciar o servidor normalmente');
        console.log('   npm run all\n');

    } catch (error) {
        console.error('\n❌ Erro durante migração:', error);
        process.exit(1);
    } finally {
        if (client) {
            await client.close();
        }
    }
}

// Executar migração
migrate().catch(console.error);
