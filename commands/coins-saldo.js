const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getCoins } = require('../utils/coins.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('coins-saldo')
        .setDescription('Ver seu saldo de coins da loja'),
    
    async execute(interaction, db) {
        await interaction.deferReply({ ephemeral: true });

        try {
            // Buscar contas do jogador
            const accounts = await db.collection('players').find({ 
                discordId: interaction.user.id 
            }).toArray();

            if (accounts.length === 0) {
                return interaction.editReply('❌ Você não tem nenhuma conta verificada no servidor.');
            }

            const embed = new EmbedBuilder()
                .setColor('#ffd700')
                .setTitle('💰 Seu Saldo de Coins')
                .setDescription(`👤 **${interaction.user.tag}**`)
                .setThumbnail(interaction.user.displayAvatarURL());

            let totalCoins = 0;

            for (const account of accounts) {
                const coins = getCoins(account.steamId);
                totalCoins += coins;

                const accountName = account.name || 'Sem stats';
                const status = account.guid && account.guid !== 'pending' ? '✅' : '⏳';

                embed.addFields({
                    name: `${status} ${accountName}`,
                    value: `**💵 Saldo:** ${coins} coins\n` +
                           `**🆔 Steam ID:** \`${account.steamId}\`\n` +
                           `**🛒 Usar:** Entre no servidor e segure **"I"**`,
                    inline: false
                });
            }

            embed.addFields({
                name: '💸 Total Geral',
                value: `**${totalCoins} coins** em ${accounts.length} conta(s)`,
                inline: false
            });

            embed.setFooter({ text: 'DayZ Apocalypse - Sistema de Coins' });
            embed.setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Erro ao buscar saldo de coins:', error);
            await interaction.editReply('❌ Erro ao buscar seu saldo. Tente novamente mais tarde.');
        }
    }
};
