const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const { formatCurrency, getStatusInfo } = require('../utils/mercadopago');
const { getCoins } = require('../utils/coins');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('admin-reembolso')
        .setDescription('[ADMIN] Sistema de reembolso de pagamentos')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(subcommand =>
            subcommand
                .setName('solicitar')
                .setDescription('Solicita reembolso de um pagamento')
                .addStringOption(option =>
                    option.setName('payment_id')
                        .setDescription('ID do pagamento')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('motivo')
                        .setDescription('Motivo do reembolso')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('analisar')
                .setDescription('Analisa se coins foram gastos')
                .addStringOption(option =>
                    option.setName('payment_id')
                        .setDescription('ID do pagamento')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('processar')
                .setDescription('Processa reembolso após aprovação')
                .addStringOption(option =>
                    option.setName('payment_id')
                        .setDescription('ID do pagamento')
                        .setRequired(true))
                .addBooleanOption(option =>
                    option.setName('remover_coins')
                        .setDescription('Remover coins do player?')
                        .setRequired(true))),
    
    async execute(interaction, db) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const subcommand = interaction.options.getSubcommand();

            if (subcommand === 'solicitar') {
                await handleSolicitar(interaction, db);
            } else if (subcommand === 'analisar') {
                await handleAnalisar(interaction, db);
            } else if (subcommand === 'processar') {
                await handleProcessar(interaction, db);
            }

        } catch (error) {
            console.error('Erro em admin-reembolso:', error);
            await interaction.editReply({ 
                content: '❌ Erro ao processar reembolso. Veja os logs.' 
            });
        }
    }
};

async function handleSolicitar(interaction, db) {
    const paymentId = interaction.options.getString('payment_id');
    const motivo = interaction.options.getString('motivo');

    const payment = await db.collection('payments').findOne({ 
        paymentId: parseInt(paymentId) 
    });

    if (!payment) {
        return interaction.editReply({ content: `❌ Pagamento \`${paymentId}\` não encontrado.` });
    }

    if (payment.status !== 'approved') {
        return interaction.editReply({ 
            content: `❌ Apenas pagamentos aprovados podem ser reembolsados. Status atual: ${payment.status}` 
        });
    }

    if (payment.refundStatus === 'refunded') {
        return interaction.editReply({ content: '❌ Este pagamento já foi reembolsado!' });
    }

    // Criar solicitação de reembolso
    await db.collection('refund_requests').insertOne({
        paymentId: payment.paymentId,
        userId: payment.userId,
        steamId: payment.steamId,
        amount: payment.amount,
        coins: payment.totalCoins,
        packageName: payment.packageName,
        motivo: motivo,
        requestedBy: interaction.user.id,
        requestedAt: new Date(),
        status: 'pending',
        analyzed: false
    });

    const embed = new EmbedBuilder()
        .setColor('#FFA500')
        .setTitle('⚠️ Solicitação de Reembolso Criada')
        .addFields(
            { name: '💳 Pagamento', value: `#${payment.paymentId}`, inline: true },
            { name: '👤 Player', value: `<@${payment.userId}>`, inline: true },
            { name: '💰 Valor', value: formatCurrency(payment.amount), inline: true },
            { name: '🪙 Coins', value: `${payment.totalCoins}`, inline: true },
            { name: '📦 Pacote', value: payment.packageName, inline: true },
            { name: '📝 Motivo', value: motivo, inline: false },
            { name: '⚠️ Próximo Passo', value: 'Use `/admin-reembolso analisar` para verificar se os coins foram gastos', inline: false }
        )
        .setFooter({ text: `Solicitado por ${interaction.user.tag}` })
        .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    console.log(`[REEMBOLSO] Solicitação criada para pagamento ${paymentId} por ${interaction.user.tag}`);
}

async function handleAnalisar(interaction, db) {
    const paymentId = interaction.options.getString('payment_id');

    const payment = await db.collection('payments').findOne({ 
        paymentId: parseInt(paymentId) 
    });

    if (!payment) {
        return interaction.editReply({ content: `❌ Pagamento \`${paymentId}\` não encontrado.` });
    }

    const refundRequest = await db.collection('refund_requests').findOne({ 
        paymentId: payment.paymentId 
    });

    if (!refundRequest) {
        return interaction.editReply({ 
            content: '❌ Nenhuma solicitação de reembolso encontrada. Use `/admin-reembolso solicitar` primeiro.' 
        });
    }

    // Verificar saldo atual do player
    const currentCoins = await getCoins(payment.steamId);
    const coinsReceived = payment.totalCoins;
    const coinsSpent = coinsReceived - currentCoins;
    const percentSpent = ((coinsSpent / coinsReceived) * 100).toFixed(1);

    // Buscar histórico de transações (se houver sistema de log de gastos)
    const transactions = await db.collection('logs').find({
        steamId: payment.steamId,
        type: 'coins_spent',
        timestamp: { $gte: payment.approvedAt }
    }).toArray();

    const totalSpentInLogs = transactions.reduce((sum, t) => sum + (t.amount || 0), 0);

    // Análise de risco
    let riskLevel = 'low';
    let riskReason = [];

    if (percentSpent > 50) {
        riskLevel = 'high';
        riskReason.push(`${percentSpent}% dos coins já foram gastos`);
    } else if (percentSpent > 20) {
        riskLevel = 'medium';
        riskReason.push(`${percentSpent}% dos coins já foram gastos`);
    }

    if (coinsSpent > 0) {
        riskReason.push(`${coinsSpent} coins foram utilizados`);
    }

    const riskColors = {
        low: '#00FF00',
        medium: '#FFA500',
        high: '#FF0000'
    };

    const riskEmojis = {
        low: '✅',
        medium: '⚠️',
        high: '❌'
    };

    const analysisEmbed = new EmbedBuilder()
        .setColor(riskColors[riskLevel])
        .setTitle('🔍 Análise de Reembolso')
        .addFields(
            { name: '💳 Pagamento', value: `#${payment.paymentId}`, inline: true },
            { name: '👤 Player', value: `<@${payment.userId}>`, inline: true },
            { name: '💰 Valor Pago', value: formatCurrency(payment.amount), inline: true },
            { name: '🪙 Coins Recebidos', value: `${coinsReceived}`, inline: true },
            { name: '💼 Saldo Atual', value: `${currentCoins}`, inline: true },
            { name: '📉 Coins Gastos', value: `${coinsSpent} (${percentSpent}%)`, inline: true },
            { 
                name: `${riskEmojis[riskLevel]} Nível de Risco`, 
                value: riskLevel.toUpperCase(), 
                inline: false 
            },
            {
                name: '📊 Análise',
                value: riskReason.length > 0 ? riskReason.join('\n') : 'Nenhum coin foi gasto. Seguro para reembolsar.',
                inline: false
            },
            {
                name: '💡 Recomendação',
                value: riskLevel === 'high' 
                    ? '❌ **NÃO RECOMENDADO** - Player já utilizou grande parte dos coins'
                    : riskLevel === 'medium'
                    ? '⚠️ **REVISAR** - Player utilizou alguns coins, avaliar caso a caso'
                    : '✅ **APROVADO** - Seguro para reembolsar, coins não foram utilizados',
                inline: false
            },
            {
                name: '⏭️ Próximo Passo',
                value: 'Use `/admin-reembolso processar` para executar o reembolso' + 
                       (coinsSpent > 0 ? ' (lembre-se de remover os coins restantes!)' : ''),
                inline: false
            }
        )
        .setFooter({ text: `Analisado por ${interaction.user.tag}` })
        .setTimestamp();

    // Atualizar status da solicitação
    await db.collection('refund_requests').updateOne(
        { paymentId: payment.paymentId },
        {
            $set: {
                analyzed: true,
                analysisDate: new Date(),
                analyzedBy: interaction.user.id,
                currentCoins: currentCoins,
                coinsSpent: coinsSpent,
                percentSpent: parseFloat(percentSpent),
                riskLevel: riskLevel,
                riskReason: riskReason
            }
        }
    );

    await interaction.editReply({ embeds: [analysisEmbed] });

    console.log(`[REEMBOLSO] Análise concluída para pagamento ${paymentId} - Risco: ${riskLevel}`);
}

async function handleProcessar(interaction, db) {
    const paymentId = interaction.options.getString('payment_id');
    const removerCoins = interaction.options.getBoolean('remover_coins');

    const payment = await db.collection('payments').findOne({ 
        paymentId: parseInt(paymentId) 
    });

    if (!payment) {
        return interaction.editReply({ content: `❌ Pagamento \`${paymentId}\` não encontrado.` });
    }

    const refundRequest = await db.collection('refund_requests').findOne({ 
        paymentId: payment.paymentId 
    });

    if (!refundRequest) {
        return interaction.editReply({ 
            content: '❌ Nenhuma solicitação de reembolso encontrada.' 
        });
    }

    if (!refundRequest.analyzed) {
        return interaction.editReply({ 
            content: '⚠️ Execute a análise primeiro usando `/admin-reembolso analisar`' 
        });
    }

    // Remover coins se solicitado
    if (removerCoins) {
        const { removeCoins } = require('../utils/coins');
        const currentCoins = await getCoins(payment.steamId);
        
        if (currentCoins > 0) {
            await removeCoins(payment.steamId, currentCoins, `Reembolso do pagamento #${payment.paymentId}`);
            console.log(`[REEMBOLSO] ${currentCoins} coins removidos de ${payment.steamId}`);
        }
    }

    // Marcar pagamento como reembolsado
    await db.collection('payments').updateOne(
        { paymentId: payment.paymentId },
        {
            $set: {
                refundStatus: 'refunded',
                refundedAt: new Date(),
                refundedBy: interaction.user.id,
                coinsRemoved: removerCoins
            }
        }
    );

    // Atualizar solicitação
    await db.collection('refund_requests').updateOne(
        { paymentId: payment.paymentId },
        {
            $set: {
                status: 'approved',
                processedAt: new Date(),
                processedBy: interaction.user.id,
                coinsRemoved: removerCoins
            }
        }
    );

    // Registrar no log
    await db.collection('logs').insertOne({
        type: 'refund_processed',
        paymentId: payment.paymentId,
        userId: payment.userId,
        steamId: payment.steamId,
        amount: payment.amount,
        coins: payment.totalCoins,
        coinsRemoved: removerCoins,
        processedBy: interaction.user.id,
        timestamp: new Date()
    });

    const successEmbed = new EmbedBuilder()
        .setColor('#00FF00')
        .setTitle('✅ Reembolso Processado')
        .setDescription('O reembolso foi marcado como processado no sistema.')
        .addFields(
            { name: '💳 Pagamento', value: `#${payment.paymentId}`, inline: true },
            { name: '👤 Player', value: `<@${payment.userId}>`, inline: true },
            { name: '💰 Valor', value: formatCurrency(payment.amount), inline: true },
            { name: '🪙 Coins Removidos', value: removerCoins ? 'Sim' : 'Não', inline: true },
            {
                name: '⚠️ IMPORTANTE',
                value: '**Você precisa fazer o reembolso manualmente no painel do Mercado Pago!**\n' +
                       `1. Acesse: https://www.mercadopago.com.br/activities\n` +
                       `2. Busque pelo pagamento #${payment.paymentId}\n` +
                       `3. Clique em "Reembolsar"\n` +
                       `4. Confirme o reembolso`,
                inline: false
            }
        )
        .setFooter({ text: `Processado por ${interaction.user.tag}` })
        .setTimestamp();

    await interaction.editReply({ embeds: [successEmbed] });

    // Notificar player por DM
    try {
        const client = interaction.client;
        const user = await client.users.fetch(payment.userId);
        
        const dmEmbed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('💸 Reembolso Aprovado')
            .setDescription('Sua solicitação de reembolso foi aprovada!')
            .addFields(
                { name: '💳 Pagamento', value: `#${payment.paymentId}`, inline: true },
                { name: '💰 Valor', value: formatCurrency(payment.amount), inline: true },
                { name: '⏰ Prazo', value: 'Até 10 dias úteis', inline: false }
            )
            .setFooter({ text: 'DayZ Apocalypse - Sistema de Reembolsos' })
            .setTimestamp();

        await user.send({ embeds: [dmEmbed] });
    } catch (error) {
        console.warn('[REEMBOLSO] Não foi possível enviar DM ao player:', error.message);
    }

    console.log(`[REEMBOLSO] Pagamento ${paymentId} processado por ${interaction.user.tag}`);
}
