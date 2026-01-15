const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('minhascontas')
        .setDescription('Ver todas as suas contas verificadas'),
    
    async execute(interaction, db) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const userAccounts = await db.collection('players').find({ 
                discordId: interaction.user.id 
            }).toArray();

            if (userAccounts.length === 0) {
                return interaction.editReply('❌ Você não tem nenhuma conta verificada.');
            }

            const embed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle(`🎮 Suas Contas Verificadas (${userAccounts.length})`)
                .setDescription(`👤 Discord: ${interaction.user.tag}`)
                .setThumbnail(interaction.user.displayAvatarURL());

            userAccounts.forEach((account, i) => {
                const kdRatio = account.deaths > 0 
                    ? (account.kills / account.deaths).toFixed(2) 
                    : account.kills || 0;
                
                const playTimeHours = Math.floor((account.playTime || 0) / 60);
                const playTimeMinutes = (account.playTime || 0) % 60;

                embed.addFields({
                    name: `📋 Conta ${i + 1} - ${account.name || 'Sem stats'}`,
                    value: `**🆔 Steam ID:** \`${account.steamId}\`\n` +
                           `**� Kills:** ${account.kills || 0}\n` +
                           `**☠️ Mortes:** ${account.deaths || 0}\n` +
                           `**� K/D:** ${kdRatio}\n` +
                           `**⏱️ Tempo Jogado:** ${playTimeHours}h${playTimeMinutes}m\n` +
                           `**💰 Dinheiro:** $${account.money || 10000}`,
                    inline: false
                });
            });

            embed.setFooter({ text: '🎮 Stats atualizadas em tempo real' });
            embed.setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('Erro ao buscar contas:', error);
            await interaction.editReply('❌ Erro ao buscar suas contas.');
        }
    }
};
