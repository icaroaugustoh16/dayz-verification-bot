/**
 * ========================================
 * 📊 ANÁLISES DE NAVEGAÇÃO DO USUÁRIO
 * ========================================
 * 
 * Este arquivo contém queries prontas para analisar
 * o comportamento dos usuários durante o fluxo de compra.
 * 
 * Use estas queries no MongoDB Compass ou via código.
 */

require('dotenv').config();
const { MongoClient } = require('mongodb');

async function runAnalytics() {
    const client = new MongoClient(process.env.MONGO_URL || process.env.MONGO_URI);
    
    try {
        await client.connect();
        const db = client.db(process.env.DATABASE_NAME || process.env.DB_NAME || 'dayz_server');
        const navigation = db.collection('user_navigation');
        
        console.log('📊 ===== ANÁLISES DE NAVEGAÇÃO DO USUÁRIO =====\n');
        
        // ============================================================
        // 1️⃣ ANÁLISE: Quais etapas têm mais cliques no botão "Voltar"?
        // ============================================================
        console.log('1️⃣ ETAPAS COM MAIS DESISTÊNCIAS (back button):');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        
        const backButtonStats = await navigation.aggregate([
            {
                $group: {
                    _id: "$from",
                    count: { $sum: 1 }
                }
            },
            { $sort: { count: -1 } }
        ]).toArray();
        
        backButtonStats.forEach((stat, index) => {
            const stepName = {
                'payment_screen': '💳 Tela de Pagamento (PIX/Cartão)',
                'payment_methods': '💰 Escolha de Forma de Pagamento',
                'server_selection': '🎮 Seleção de Servidor'
            }[stat._id] || stat._id;
            
            console.log(`   ${index + 1}. ${stepName}`);
            console.log(`      → ${stat.count} usuários voltaram desta etapa\n`);
        });
        
        console.log('💡 Interpretação:');
        console.log('   • Se "Tela de Pagamento" tem muitos cliques: usuários podem estar confusos com PIX/Cartão');
        console.log('   • Se "Escolha de Forma de Pagamento" tem muitos cliques: pode estar faltando informação');
        console.log('   • Se "Seleção de Servidor" tem muitos cliques: descrição dos servidores pode estar confusa\n');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n');
        
        // ============================================================
        // 2️⃣ ANÁLISE: Usuários indecisos (clicam muito em voltar)
        // ============================================================
        console.log('2️⃣ USUÁRIOS MAIS INDECISOS (top 10):');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        
        const indecisiveUsers = await navigation.aggregate([
            {
                $group: {
                    _id: "$userId",
                    userTag: { $first: "$userTag" },
                    count: { $sum: 1 }
                }
            },
            { $sort: { count: -1 } },
            { $limit: 10 }
        ]).toArray();
        
        indecisiveUsers.forEach((user, index) => {
            console.log(`   ${index + 1}. ${user.userTag || 'Usuário desconhecido'}`);
            console.log(`      → Clicou em "Voltar" ${user.count}x`);
            console.log(`      → Discord ID: ${user._id}\n`);
        });
        
        console.log('💡 Interpretação:');
        console.log('   • Usuários com 5+ cliques: podem estar com dúvidas ou problemas de UX');
        console.log('   • Considere entrar em contato para entender a dificuldade');
        console.log('   • Pode indicar necessidade de melhorar textos/instruções\n');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n');
        
        // ============================================================
        // 3️⃣ ANÁLISE: Fluxo de navegação (últimos 50 eventos)
        // ============================================================
        console.log('3️⃣ FLUXO DE NAVEGAÇÃO RECENTE (últimos 50):');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        
        const recentNavigation = await navigation.find({})
            .sort({ timestamp: -1 })
            .limit(50)
            .toArray();
        
        recentNavigation.forEach((nav, index) => {
            const time = new Date(nav.timestamp).toLocaleString('pt-BR');
            const flowEmoji = {
                'payment_screen': '💳',
                'payment_methods': '💰',
                'server_selection': '🎮'
            }[nav.from] || '❓';
            
            console.log(`   ${index + 1}. [${time}] ${nav.userTag}`);
            console.log(`      → ${flowEmoji} Voltou de: ${nav.from}`);
            console.log(`      → 📍 Para: ${nav.to}\n`);
        });
        
        console.log('💡 Interpretação:');
        console.log('   • Monitore padrões: usuários voltando sempre da mesma etapa');
        console.log('   • Identifique horários de pico de desistências');
        console.log('   • Verifique se há problemas técnicos em horários específicos\n');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n');
        
        // ============================================================
        // 4️⃣ ANÁLISE: Taxa de conversão por servidor
        // ============================================================
        console.log('4️⃣ SERVIDORES MAIS ESCOLHIDOS (antes de voltar):');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        
        const serverStats = await navigation.aggregate([
            {
                $match: { serverType: { $exists: true } }
            },
            {
                $group: {
                    _id: "$serverName",
                    count: { $sum: 1 }
                }
            },
            { $sort: { count: -1 } }
        ]).toArray();
        
        if (serverStats.length > 0) {
            serverStats.forEach((stat, index) => {
                const emoji = stat._id === 'FullMod' ? '🔧' : '🌿';
                console.log(`   ${index + 1}. ${emoji} ${stat._id}`);
                console.log(`      → ${stat.count} usuários voltaram após escolher este servidor\n`);
            });
            
            console.log('💡 Interpretação:');
            console.log('   • Se um servidor tem muitas desistências: pode estar confuso ou com problema');
            console.log('   • Compare com compras concluídas para ver taxa de conversão real\n');
        } else {
            console.log('   ⚠️  Ainda não há dados de servidor nos registros de navegação.\n');
        }
        
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n');
        
        // ============================================================
        // 5️⃣ ANÁLISE: Pacotes mais "abandonados"
        // ============================================================
        console.log('5️⃣ PACOTES COM MAIS DESISTÊNCIAS:');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        
        const packageStats = await navigation.aggregate([
            {
                $group: {
                    _id: "$packageId",
                    count: { $sum: 1 }
                }
            },
            { $sort: { count: -1 } }
        ]).toArray();
        
        packageStats.forEach((stat, index) => {
            console.log(`   ${index + 1}. Pacote: ${stat._id}`);
            console.log(`      → ${stat.count} usuários voltaram durante compra deste pacote\n`);
        });
        
        console.log('💡 Interpretação:');
        console.log('   • Pacotes mais caros tendem a ter mais desistências (normal)');
        console.log('   • Se um pacote barato tem muitas desistências: pode haver problema no preço/descrição\n');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n');
        
        // ============================================================
        // 6️⃣ ANÁLISE: Resumo geral
        // ============================================================
        console.log('6️⃣ RESUMO GERAL:');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        
        const totalNavigations = await navigation.countDocuments();
        const uniqueUsers = await navigation.distinct('userId');
        const avgBacksPerUser = (totalNavigations / uniqueUsers.length).toFixed(2);
        
        console.log(`   📊 Total de cliques em "Voltar": ${totalNavigations}`);
        console.log(`   👥 Usuários únicos: ${uniqueUsers.length}`);
        console.log(`   📈 Média de "Voltar" por usuário: ${avgBacksPerUser}x\n`);
        
        console.log('💡 Benchmarks recomendados:');
        console.log('   • Média < 2.0: Fluxo está bom! ✅');
        console.log('   • Média 2.0-3.0: Fluxo aceitável, pode melhorar ⚠️');
        console.log('   • Média > 3.0: Fluxo confuso, precisa revisar UX ❌\n');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n');
        
        console.log('✅ Análises concluídas!\n');
        console.log('💡 DICA: Execute este script semanalmente para acompanhar tendências.\n');
        
    } catch (error) {
        console.error('❌ Erro ao executar análises:', error);
    } finally {
        await client.close();
    }
}

// ============================================================
// FUNÇÕES AUXILIARES PARA ANÁLISES ESPECÍFICAS
// ============================================================

/**
 * Buscar usuários que voltaram mais de X vezes
 */
async function findIndecisiveUsers(minBackClicks = 5) {
    const client = new MongoClient(process.env.MONGO_URL || process.env.MONGO_URI);
    await client.connect();
    const db = client.db(process.env.DATABASE_NAME || 'dayz_server');
    
    const result = await db.collection('user_navigation').aggregate([
        {
            $group: {
                _id: "$userId",
                userTag: { $first: "$userTag" },
                count: { $sum: 1 }
            }
        },
        {
            $match: { count: { $gte: minBackClicks } }
        },
        { $sort: { count: -1 } }
    ]).toArray();
    
    await client.close();
    return result;
}

/**
 * Buscar navegações de um usuário específico
 */
async function getUserNavigationHistory(userId) {
    const client = new MongoClient(process.env.MONGO_URL || process.env.MONGO_URI);
    await client.connect();
    const db = client.db(process.env.DATABASE_NAME || 'dayz_server');
    
    const result = await db.collection('user_navigation')
        .find({ userId: userId })
        .sort({ timestamp: -1 })
        .toArray();
    
    await client.close();
    return result;
}

/**
 * Comparar desistências vs compras concluídas
 */
async function compareAbandonmentVsCompletion() {
    const client = new MongoClient(process.env.MONGO_URL || process.env.MONGO_URI);
    await client.connect();
    const db = client.db(process.env.DATABASE_NAME || 'dayz_server');
    
    const totalBackClicks = await db.collection('user_navigation').countDocuments();
    const completedPayments = await db.collection('payments').countDocuments({ status: 'approved' });
    const cancelledPayments = await db.collection('payments').countDocuments({ status: 'cancelled' });
    
    const conversionRate = ((completedPayments / (completedPayments + cancelledPayments)) * 100).toFixed(2);
    
    await client.close();
    
    return {
        totalBackClicks,
        completedPayments,
        cancelledPayments,
        conversionRate: `${conversionRate}%`
    };
}

// ============================================================
// EXECUTAR ANÁLISES
// ============================================================

if (require.main === module) {
    runAnalytics();
}

module.exports = {
    runAnalytics,
    findIndecisiveUsers,
    getUserNavigationHistory,
    compareAbandonmentVsCompletion
};
