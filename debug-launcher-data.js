// ============================================================================
// DEBUG-LAUNCHER-DATA.JS - Mostra exatamente o que o launcher está enviando
// ============================================================================

require('dotenv').config();
const { MongoClient } = require('mongodb');

const config = {
    url: process.env.MONGO_URL || 'mongodb://localhost:27017',
    dbName: process.env.DATABASE_NAME || 'dayz_server'
};

async function debugLauncherData() {
    let client;

    try {
        console.log('🔍 Conectando ao MongoDB...\n');
        client = await MongoClient.connect(config.url);
        const db = client.db(config.dbName);
        const playersCollection = db.collection('players');

        // Buscar o player mais recente (último a fazer login)
        const latestPlayer = await playersCollection
            .find({})
            .sort({ lastLauncherCheck: -1 })
            .limit(1)
            .toArray();

        if (!latestPlayer || latestPlayer.length === 0) {
            console.log('❌ Nenhum player encontrado no banco');
            return;
        }

        const player = latestPlayer[0];

        console.log('═══════════════════════════════════════════════════════════');
        console.log('📊 DADOS DO ÚLTIMO JOGADOR QUE USOU O LAUNCHER');
        console.log('═══════════════════════════════════════════════════════════\n');

        console.log('🎮 IDENTIFICAÇÃO:');
        console.log(`  Steam ID: ${player.steamId}`);
        console.log(`  Nome: ${player.name || 'N/A'}`);
        console.log(`  Discord: ${player.discordTag || 'N/A'} (${player.discordId || 'N/A'})`);
        console.log(`  GUID: ${player.guid || 'N/A'}\n`);

        console.log('🔐 VERIFICAÇÃO:');
        console.log(`  ✅ Verificado Discord: ${player.verified ? 'SIM' : 'NÃO'}`);
        console.log(`  ✅ Verificado Launcher: ${player.launcherVerified ? 'SIM' : 'NÃO'}`);
        console.log(`  ✅ Aguardando GUID: ${player.awaitingGuid ? 'SIM' : 'NÃO'}\n`);

        console.log('💻 INFORMAÇÕES DO SISTEMA:');
        console.log(`  Nome da Máquina: ${player.machineName || '❌ FALTANDO'}`);
        console.log(`  Sistema Operacional: ${player.osVersion || '❌ FALTANDO'}`);
        console.log(`  IP: ${player.lastIp || 'N/A'}`);
        console.log(`  Versão Launcher: ${player.lastLauncherVersion || 'N/A'}\n`);

        console.log('🔧 HARDWARE (IDs Únicos):');
        console.log(`  Hardware ID: ${player.hardwareId || '❌ FALTANDO'}`);
        console.log(`  CPU ID: ${player.cpuId || '❌ FALTANDO'}`);
        console.log(`  GPU ID: ${player.gpuId || '❌ FALTANDO'}`);
        console.log(`  Motherboard Serial: ${player.motherboardSerial || '❌ FALTANDO'}`);
        console.log(`  BIOS Serial: ${player.biosSerial || '❌ FALTANDO'}`);
        console.log(`  Windows Product ID: ${player.windowsProductId || '❌ FALTANDO'}\n`);

        console.log('📦 ARRAYS DE HARDWARE:');
        console.log(`  Known Steam IDs (${player.knownSteamIds?.length || 0}):`);
        if (player.knownSteamIds && player.knownSteamIds.length > 0) {
            player.knownSteamIds.forEach(id => console.log(`    - ${id}`));
        } else {
            console.log('    ❌ FALTANDO ou VAZIO');
        }

        console.log(`\n  Disk Serials (${player.diskSerials?.length || 0}):`);
        if (player.diskSerials && player.diskSerials.length > 0) {
            player.diskSerials.forEach(disk => console.log(`    - ${disk}`));
        } else {
            console.log('    ❌ FALTANDO ou VAZIO');
        }

        console.log(`\n  MAC Addresses (${player.macAddresses?.length || 0}):`);
        if (player.macAddresses && player.macAddresses.length > 0) {
            player.macAddresses.forEach(mac => console.log(`    - ${mac}`));
        } else {
            console.log('    ❌ FALTANDO ou VAZIO');
        }

        console.log(`\n  RAM Serial Numbers (${player.ramSerialNumbers?.length || 0}):`);
        if (player.ramSerialNumbers && player.ramSerialNumbers.length > 0) {
            player.ramSerialNumbers.forEach(ram => console.log(`    - ${ram}`));
        } else {
            console.log('    ❌ FALTANDO ou VAZIO');
        }

        console.log(`\n  Network Adapter IDs (${player.networkAdapterIds?.length || 0}):`);
        if (player.networkAdapterIds && player.networkAdapterIds.length > 0) {
            player.networkAdapterIds.forEach(net => console.log(`    - ${net}`));
        } else {
            console.log('    ❌ FALTANDO ou VAZIO');
        }

        console.log('\n📅 TIMESTAMPS:');
        console.log(`  Primeiro Login: ${player.firstJoin?.toISOString() || 'N/A'}`);
        console.log(`  Último Login: ${player.lastLogin?.toISOString() || 'N/A'}`);
        console.log(`  Último Check Launcher: ${player.lastLauncherCheck?.toISOString() || 'N/A'}`);
        console.log(`  Verificado em: ${player.verifiedAt?.toISOString() || 'N/A'}\n`);

        console.log('═══════════════════════════════════════════════════════════');
        console.log('📋 RESUMO - O QUE ESTÁ FALTANDO:');
        console.log('═══════════════════════════════════════════════════════════\n');

        const missing = [];
        const present = [];

        // Verificar campos obrigatórios
        const fields = [
            { name: 'machineName', value: player.machineName },
            { name: 'osVersion', value: player.osVersion },
            { name: 'hardwareId', value: player.hardwareId },
            { name: 'cpuId', value: player.cpuId },
            { name: 'gpuId', value: player.gpuId },
            { name: 'motherboardSerial', value: player.motherboardSerial },
            { name: 'biosSerial', value: player.biosSerial },
            { name: 'windowsProductId', value: player.windowsProductId },
        ];

        fields.forEach(field => {
            if (!field.value || field.value === null) {
                missing.push(`  ❌ ${field.name}`);
            } else {
                present.push(`  ✅ ${field.name}`);
            }
        });

        // Verificar arrays
        const arrays = [
            { name: 'knownSteamIds', value: player.knownSteamIds },
            { name: 'diskSerials', value: player.diskSerials },
            { name: 'macAddresses', value: player.macAddresses },
            { name: 'ramSerialNumbers', value: player.ramSerialNumbers },
            { name: 'networkAdapterIds', value: player.networkAdapterIds },
        ];

        arrays.forEach(arr => {
            if (!arr.value || arr.value.length === 0) {
                missing.push(`  ❌ ${arr.name} (vazio)`);
            } else {
                present.push(`  ✅ ${arr.name} (${arr.value.length} itens)`);
            }
        });

        console.log('✅ CAMPOS PRESENTES:');
        present.forEach(p => console.log(p));

        if (missing.length > 0) {
            console.log('\n❌ CAMPOS FALTANDO:');
            missing.forEach(m => console.log(m));
            console.log('\n⚠️  Esses campos estão faltando porque:');
            console.log('   1. O LAUNCHER não está coletando/enviando esses dados');
            console.log('   2. Ou você precisa atualizar o launcher para enviar mais dados\n');
        } else {
            console.log('\n🎉 TODOS OS CAMPOS ESTÃO PRESENTES!\n');
        }

        console.log('═══════════════════════════════════════════════════════════');
        console.log('💡 PRÓXIMO PASSO:');
        console.log('═══════════════════════════════════════════════════════════\n');

        if (missing.length > 0) {
            console.log('Se há campos faltando, você precisa:');
            console.log('1. Verificar se o LAUNCHER está coletando esses dados');
            console.log('2. Atualizar o launcher para enviar todos os campos');
            console.log('3. O server.js JÁ ESTÁ preparado para receber tudo!\n');
        } else {
            console.log('✅ Tudo certo! O launcher está enviando todos os dados.\n');
        }

    } catch (error) {
        console.error('❌ Erro:', error);
    } finally {
        if (client) {
            await client.close();
        }
    }
}

// Executar
debugLauncherData().catch(console.error);
