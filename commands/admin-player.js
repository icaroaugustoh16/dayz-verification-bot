const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('admin-player')
        .setDescription('[ADMIN] Ver informações detalhadas de um jogador')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption(option =>
            option.setName('usuario')
                .setDescription('Usuário do Discord')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('steamid')
                .setDescription('Steam ID do jogador')
                .setRequired(false)),
    
    async execute(interaction, db) {
        const user = interaction.options.getUser('usuario');
        const steamId = interaction.options.getString('steamid');

        if (!user && !steamId) {
            return interaction.reply({ 
                content: '❌ Forneça um usuário OU Steam ID.', 
                ephemeral: true 
            });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            let accounts;

            if (user) {
                accounts = await db.collection('players').find({ discordId: user.id }).toArray();
                
                if (accounts.length === 0) {
                    return interaction.editReply(`❌ ${user.tag} não tem nenhuma conta verificada.`);
                }
            } else {
                const player = await db.collection('players').findOne({ steamId });
                if (!player) {
                    return interaction.editReply('❌ Steam ID não encontrado.');
                }
                accounts = [player];
            }

            const embed = new EmbedBuilder()
                .setColor('#ff9900')
                .setTitle(`👮 Informações Administrativas`)
                .setDescription(user ? `**Usuário:** ${user.tag}\n**Discord ID:** \`${user.id}\`\n**Total de Contas:** ${accounts.length}` : `**Steam ID:** \`${steamId}\``)
                .setThumbnail(user ? user.displayAvatarURL() : null);

            accounts.forEach((account, i) => {
                const status = account.guid && account.guid !== "pending" ? '✅ Completo' : '⏳ Pendente';
                const onlineStatus = account.online ? '🟢 Online' : '🔴 Offline';
                const kdRatio = account.deaths > 0 
                    ? (account.kills / account.deaths).toFixed(2) 
                    : account.kills || 0;

                embed.addFields({
                    name: `📋 Conta ${i + 1} - ${status} | ${onlineStatus}`,
                    value: `**🆔 Steam ID:** \`${account.steamId}\`\n` +
                           `**🔑 GUID:** \`${account.guid || 'pending'}\`\n` +
                           `**🎯 In-Game:** ${account.name || 'Não jogou ainda'}\n` +
                           `**👤 Discord:** ${account.discordTag || 'Não vinculado'}\n` +
                           `**📡 Último IP:** \`${account.lastIp || 'N/A'}\`\n` +
                           `**🖥️ HWID:** \`${account.hardwareId?.substring(0, 20) || 'N/A'}...\`\n` +
                           `**💀 K/D:** ${account.kills || 0}/${account.deaths || 0} (${kdRatio})\n` +
                           `**🧟 Zombie Kills:** ${account.zombieKills || 0}\n` +
                           `**💰 Dinheiro:** $${account.money || 0}\n` +
                           `**⏱️ Tempo Jogado:** ${Math.floor((account.playTime || 0) / 60)}h\n` +
                           `**📅 Primeiro Login:** ${account.firstJoin ? new Date(account.firstJoin).toLocaleString('pt-BR') : 'N/A'}\n` +
                           `**📅 Último Login:** ${account.lastLogin ? new Date(account.lastLogin).toLocaleString('pt-BR') : 'N/A'}`,
                    inline: false
                });
            });

            embed.setFooter({ text: `Requisitado por ${interaction.user.tag}` });
            embed.setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('Erro ao buscar jogador:', error);
            await interaction.editReply('❌ Erro ao buscar informações.');
        }
    }
};
