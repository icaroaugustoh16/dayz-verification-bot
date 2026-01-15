// Script para processar pagamento pendente manualmente
require('dotenv').config();
const { MongoClient } = require('mongodb');
const { MercadoPagoConfig, Payment } = require('mercadopago');

const PAYMENT_ID = '129891679010'; // Altere aqui se necessário

(async () => {
    try {
        console.log('🔍 Verificando pagamento', PAYMENT_ID, '...\n');

        // Conectar ao MongoDB
        const mongoClient = await MongoClient.connect(process.env.MONGO_URL);
        const db = mongoClient.db(process.env.DATABASE_NAME || 'dayz_server');
        console.log('✅ Conectado ao MongoDB');

        // Buscar pagamento no banco
        const paymentRecord = await db.collection('payments').findOne({ 
            paymentId: parseInt(PAYMENT_ID) 
        });

        if (!paymentRecord) {
            console.error('❌ Pagamento não encontrado no banco de dados!');
            await mongoClient.close();
            return;
        }

        console.log('\n📦 Dados do Pagamento:');
        console.log('   User:', paymentRecord.userId);
        console.log('   Steam ID:', paymentRecord.steamId);
        console.log('   Pacote:', paymentRecord.packageName);
        console.log('   Coins:', paymentRecord.coins);
        console.log('   Bônus:', paymentRecord.bonus);
        console.log('   Total:', paymentRecord.totalCoins, 'coins');
        console.log('   Status no DB:', paymentRecord.status);

        // Verificar se já foi processado
        if (paymentRecord.status === 'approved' || paymentRecord.status === 'completed') {
            console.log('\n⚠️  Pagamento já foi processado anteriormente!');
            await mongoClient.close();
            return;
        }

        // Consultar status no Mercado Pago
        const mpClient = new MercadoPagoConfig({ 
            accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN 
        });
        const paymentAPI = new Payment(mpClient);

        console.log('\n🔄 Consultando Mercado Pago...');
        const mpPayment = await paymentAPI.get({ id: PAYMENT_ID });
        console.log('   Status no MP:', mpPayment.status);

        if (mpPayment.status !== 'approved') {
            console.log('\n❌ Pagamento não está aprovado no Mercado Pago!');
            console.log('   Status atual:', mpPayment.status);
            console.log('   Detalhe:', mpPayment.status_detail);
            await mongoClient.close();
            return;
        }

        console.log('\n✅ Pagamento APROVADO! Processando...');

        // Buscar player
        const player = await db.collection('players').findOne({ 
            steamId: paymentRecord.steamId 
        });

        if (!player) {
            console.error('\n❌ Player não encontrado no banco de dados!');
            await mongoClient.close();
            return;
        }

        console.log('\n👤 Player encontrado:');
        console.log('   Nome:', player.steamName || player.name);
        console.log('   Coins atuais:', player.coins || 0);

        // Adicionar coins
        const totalCoins = paymentRecord.coins + paymentRecord.bonus;
        const newCoinsTotal = (player.coins || 0) + totalCoins;

        await db.collection('players').updateOne(
            { steamId: paymentRecord.steamId },
            { 
                $inc: { coins: totalCoins },
                $set: { updatedAt: new Date() }
            }
        );

        console.log('   Coins adicionados:', '+' + totalCoins);
        console.log('   Novo total:', newCoinsTotal);

        // Atualizar status do pagamento
        await db.collection('payments').updateOne(
            { paymentId: parseInt(PAYMENT_ID) },
            { 
                $set: { 
                    status: 'approved',
                    processedAt: new Date(),
                    manuallyProcessed: true
                } 
            }
        );

        console.log('\n✅ Pagamento processado com sucesso!');

        // Criar log
        await db.collection('logs').insertOne({
            type: 'coin_purchase_manual_script',
            userId: paymentRecord.userId,
            steamId: paymentRecord.steamId,
            paymentId: parseInt(PAYMENT_ID),
            amount: paymentRecord.amount,
            coins: totalCoins,
            packageId: paymentRecord.packageId,
            timestamp: new Date()
        });

        console.log('📝 Log criado');

        await mongoClient.close();
        console.log('\n🎉 CONCLUÍDO! O player recebeu', totalCoins, 'coins.');

    } catch (error) {
        console.error('\n❌ ERRO:', error.message);
        console.error(error);
    }
})();
