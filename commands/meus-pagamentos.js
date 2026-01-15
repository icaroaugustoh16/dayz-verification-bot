const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { formatCurrency, getStatusInfo } = require('../utils/mercadopago');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('meus-pagamentos')
        .setDescription('Veja o histórico dos seus pagamentos e compras de coins'),
    
    async execute(interaction, db) {
        await interaction.deferReply({ ephemeral: true });

        try {
            // Buscar pagamentos do usuário
            const payments = await db.collection('payments')
                .find({ userId: interaction.user.id })
                .sort({ createdAt: -1 })
                .limit(10)
                .toArray();

            if (payments.length === 0) {
                const noPaymentsEmbed = new EmbedBuilder()
                    .setColor('#FFA500')
                    .setTitle('📊 Seus Pagamentos')
                    .setDescription('Você ainda não realizou nenhuma compra de coins.')
                    .addFields({
                        name: '💡 Como Comprar',
                        value: 'Vá até o canal da loja e selecione um pacote de coins!',
                        inline: false
                    })
                    .setFooter({ text: 'DayZ Apocalypse - Sistema de Pagamentos' })
                    .setTimestamp();

                return interaction.editReply({ embeds: [noPaymentsEmbed] });
            }

            // Calcular estatísticas
            const totalPaid = payments
                .filter(p => p.status === 'approved')
                .reduce((sum, p) => sum + p.amount, 0);
            
            const totalCoins = payments
                .filter(p => p.status === 'approved')
                .reduce((sum, p) => sum + p.totalCoins, 0);

            const approvedCount = payments.filter(p => p.status === 'approved').length;
            const pendingCount = payments.filter(p => p.status === 'pending').length;

            // Criar embed principal
            const historyEmbed = new EmbedBuilder()
                .setColor('#00FF00')
                .setTitle('📊 Histórico de Pagamentos')
                .setDescription(`Mostrando seus últimos ${payments.length} pagamentos`)
                .addFields(
                    { 
                        name: '💰 Total Gasto', 
                        value: formatCurrency(totalPaid), 
                        inline: true 
                    },
                    { 
                        name: '🪙 Total de Coins', 
                        value: `${totalCoins} coins`, 
                        inline: true 
                    },
                    { 
                        name: '📈 Estatísticas', 
                        value: `✅ ${approvedCount} aprovados\n⏳ ${pendingCount} pendentes`, 
                        inline: true 
                    }
                )
                .setFooter({ text: `Solicitado por ${interaction.user.tag}` })
                .setTimestamp();

            // Adicionar últimos pagamentos
            let paymentsText = '';
            payments.slice(0, 5).forEach(payment => {
                const statusInfo = getStatusInfo(payment.status);
                const date = new Date(payment.createdAt).toLocaleDateString('pt-BR');
                const bonusText = payment.bonus > 0 ? ` (+${payment.bonus})` : '';
                
                paymentsText += `${statusInfo.emoji} **${payment.packageName}**\n`;
                paymentsText += `└ ${formatCurrency(payment.amount)} • ${payment.totalCoins} coins${bonusText} • ${date}\n`;
                paymentsText += `└ ID: \`${payment.paymentId}\`\n\n`;
            });

            historyEmbed.addFields({
                name: '📜 Últimos Pagamentos',
                value: paymentsText || 'Nenhum pagamento encontrado',
                inline: false
            });

            await interaction.editReply({ embeds: [historyEmbed] });

            console.log(`[PAGAMENTOS] ${interaction.user.tag} consultou histórico`);

        } catch (error) {
            console.error('Erro ao buscar pagamentos:', error);
            await interaction.editReply({ 
                content: '❌ Erro ao buscar histórico de pagamentos. Tente novamente mais tarde.' 
            });
        }
    }
};
