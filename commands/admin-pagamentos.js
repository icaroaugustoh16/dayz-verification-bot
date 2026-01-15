const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { formatCurrency, getStatusInfo } = require('../utils/mercadopago');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('admin-pagamentos')
        .setDescription('[ADMIN] Visualiza todos os pagamentos do sistema')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(subcommand =>
            subcommand
                .setName('listar')
                .setDescription('Lista os últimos pagamentos')
                .addStringOption(option =>
                    option.setName('status')
                        .setDescription('Filtrar por status')
                        .setRequired(false)
                        .addChoices(
                            { name: '✅ Aprovados', value: 'approved' },
                            { name: '⏳ Pendentes', value: 'pending' },
                            { name: '❌ Recusados', value: 'rejected' },
                            { name: '🚫 Cancelados', value: 'cancelled' }
                        ))
                .addIntegerOption(option =>
                    option.setName('limite')
                        .setDescription('Quantidade de resultados (padrão: 10)')
                        .setRequired(false)
                        .setMinValue(1)
                        .setMaxValue(50)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('estatisticas')
                .setDescription('Mostra estatísticas gerais de pagamentos'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('buscar')
                .setDescription('Busca um pagamento específico')
                .addStringOption(option =>
                    option.setName('payment_id')
                        .setDescription('ID do pagamento no Mercado Pago')
                        .setRequired(true))),
    
    async execute(interaction, db) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const subcommand = interaction.options.getSubcommand();

            if (subcommand === 'listar') {
                await handleList(interaction, db);
            } else if (subcommand === 'estatisticas') {
                await handleStats(interaction, db);
            } else if (subcommand === 'buscar') {
                await handleSearch(interaction, db);
            }

        } catch (error) {
            console.error('Erro em admin-pagamentos:', error);
            await interaction.editReply({ 
                content: '❌ Erro ao executar comando. Veja os logs para mais detalhes.' 
            });
        }
    }
};

async function handleList(interaction, db) {
    const status = interaction.options.getString('status');
    const limit = interaction.options.getInteger('limite') || 10;

    const filter = status ? { status } : {};
    
    const payments = await db.collection('payments')
        .find(filter)
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();

    if (payments.length === 0) {
        return interaction.editReply({ 
            content: `ℹ️ Nenhum pagamento encontrado${status ? ` com status "${status}"` : ''}.` 
        });
    }

    const listEmbed = new EmbedBuilder()
        .setColor('#0099FF')
        .setTitle('💳 Lista de Pagamentos')
        .setDescription(`Mostrando ${payments.length} pagamento(s)${status ? ` com status "${status}"` : ''}`)
        .setFooter({ text: `Solicitado por ${interaction.user.tag}` })
        .setTimestamp();

    let paymentsText = '';
    payments.forEach(payment => {
        const statusInfo = getStatusInfo(payment.status);
        const date = new Date(payment.createdAt).toLocaleString('pt-BR');
        
        paymentsText += `${statusInfo.emoji} **${payment.packageName}** - ${formatCurrency(payment.amount)}\n`;
        paymentsText += `└ Player: <@${payment.userId}> | Steam: \`${payment.steamId}\`\n`;
        paymentsText += `└ Coins: ${payment.totalCoins} (${payment.coins}+${payment.bonus}) | ${date}\n`;
        paymentsText += `└ ID: \`${payment.paymentId}\`\n\n`;
    });

    listEmbed.addFields({
        name: '📋 Pagamentos',
        value: paymentsText.slice(0, 1024) || 'Nenhum pagamento',
        inline: false
    });

    await interaction.editReply({ embeds: [listEmbed] });
}

async function handleStats(interaction, db) {
    const payments = await db.collection('payments').find({}).toArray();

    if (payments.length === 0) {
        return interaction.editReply({ content: 'ℹ️ Nenhum pagamento registrado ainda.' });
    }

    const approved = payments.filter(p => p.status === 'approved');
    const pending = payments.filter(p => p.status === 'pending');
    const rejected = payments.filter(p => p.status === 'rejected');
    const cancelled = payments.filter(p => p.status === 'cancelled');

    const totalRevenue = approved.reduce((sum, p) => sum + p.amount, 0);
    const totalCoins = approved.reduce((sum, p) => sum + p.totalCoins, 0);
    const averageTicket = approved.length > 0 ? totalRevenue / approved.length : 0;

    // Agrupar por pacote
    const packageStats = {};
    approved.forEach(p => {
        if (!packageStats[p.packageId]) {
            packageStats[p.packageId] = {
                name: p.packageName,
                count: 0,
                revenue: 0
            };
        }
        packageStats[p.packageId].count++;
        packageStats[p.packageId].revenue += p.amount;
    });

    const topPackages = Object.values(packageStats)
        .sort((a, b) => b.count - a.count)
        .slice(0, 3);

    const statsEmbed = new EmbedBuilder()
        .setColor('#FFD700')
        .setTitle('📊 Estatísticas de Pagamentos')
        .addFields(
            {
                name: '💰 Receita Total',
                value: formatCurrency(totalRevenue),
                inline: true
            },
            {
                name: '🪙 Coins Vendidos',
                value: `${totalCoins} coins`,
                inline: true
            },
            {
                name: '📈 Ticket Médio',
                value: formatCurrency(averageTicket),
                inline: true
            },
            {
                name: '✅ Aprovados',
                value: `${approved.length} (${((approved.length / payments.length) * 100).toFixed(1)}%)`,
                inline: true
            },
            {
                name: '⏳ Pendentes',
                value: `${pending.length}`,
                inline: true
            },
            {
                name: '❌ Recusados/Cancelados',
                value: `${rejected.length + cancelled.length}`,
                inline: true
            }
        )
        .setFooter({ text: `Total de ${payments.length} pagamentos registrados` })
        .setTimestamp();

    if (topPackages.length > 0) {
        let topText = '';
        topPackages.forEach((pkg, index) => {
            const medal = ['🥇', '🥈', '🥉'][index] || '🏅';
            topText += `${medal} **${pkg.name}**\n`;
            topText += `└ ${pkg.count} vendas • ${formatCurrency(pkg.revenue)}\n\n`;
        });

        statsEmbed.addFields({
            name: '🏆 Pacotes Mais Vendidos',
            value: topText,
            inline: false
        });
    }

    await interaction.editReply({ embeds: [statsEmbed] });
}

async function handleSearch(interaction, db) {
    const paymentId = interaction.options.getString('payment_id');

    const payment = await db.collection('payments').findOne({ 
        paymentId: parseInt(paymentId) 
    });

    if (!payment) {
        return interaction.editReply({ 
            content: `❌ Pagamento \`${paymentId}\` não encontrado.` 
        });
    }

    const statusInfo = getStatusInfo(payment.status);
    const createdAt = new Date(payment.createdAt).toLocaleString('pt-BR');
    const expiresAt = new Date(payment.expiresAt).toLocaleString('pt-BR');
    const approvedAt = payment.approvedAt ? new Date(payment.approvedAt).toLocaleString('pt-BR') : 'N/A';

    const detailsEmbed = new EmbedBuilder()
        .setColor(statusInfo.color)
        .setTitle(`${statusInfo.emoji} Detalhes do Pagamento`)
        .addFields(
            { name: '🆔 ID do Pagamento', value: `\`${payment.paymentId}\``, inline: true },
            { name: '📊 Status', value: statusInfo.text, inline: true },
            { name: '💰 Valor', value: formatCurrency(payment.amount), inline: true },
            { name: '👤 Player', value: `<@${payment.userId}>`, inline: true },
            { name: '🆔 Steam ID', value: `\`${payment.steamId}\``, inline: true },
            { name: '📦 Pacote', value: payment.packageName, inline: true },
            { name: '🪙 Coins', value: `${payment.coins}`, inline: true },
            { name: '🎁 Bônus', value: `${payment.bonus}`, inline: true },
            { name: '📦 Total', value: `${payment.totalCoins}`, inline: true },
            { name: '🕐 Criado em', value: createdAt, inline: true },
            { name: '⏰ Expira em', value: expiresAt, inline: true },
            { name: '✅ Aprovado em', value: approvedAt, inline: true },
            { name: '🔄 Processado', value: payment.processed ? 'Sim' : 'Não', inline: true }
        )
        .setFooter({ text: `Consultado por ${interaction.user.tag}` })
        .setTimestamp();

    await interaction.editReply({ embeds: [detailsEmbed] });
}
