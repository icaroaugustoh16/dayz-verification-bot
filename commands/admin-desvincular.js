const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('admin-desvincular')
        .setDescription('[ADMIN] Desvincular conta de um Discord')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(option =>
            option.setName('steamid')
                .setDescription('Steam ID para desvincular')
                .setRequired(true)),
    
    async execute(interaction, db) {
        const steamId = interaction.options.getString('steamid');

        if (!/^\d{17}$/.test(steamId)) {
            return interaction.reply({ 
                content: '❌ Steam ID inválido!', 
                ephemeral: true 
            });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            const player = await db.collection('players').findOne({ steamId });

            if (!player) {
                return interaction.editReply('❌ Steam ID não encontrada.');
            }

            // Remover da whitelist
            const whitelistPath = process.env.WHITELIST_PATH;
            if (fs.existsSync(whitelistPath)) {
                let content = fs.readFileSync(whitelistPath, 'utf8');
                const lines = content.split('\n').filter(line => !line.includes(steamId));
                fs.writeFileSync(whitelistPath, lines.join('\n'));
            }

            // Desvincular no banco
            await db.collection('players').updateOne(
                { steamId },
                { 
                    $unset: { 
                        discordId: "",
                        discordTag: "",
                        verified: "",
                        launcherVerified: ""
                    },
                    $set: {
                        guid: "pending"
                    }
                }
            );

            const embed = new EmbedBuilder()
                .setColor('#ff9900')
                .setTitle('🔓 Conta Desvinculada')
                .addFields(
                    { name: '🆔 Steam ID', value: `\`${steamId}\``, inline: false },
                    { name: '👤 Discord Anterior', value: player.discordTag || 'N/A', inline: true },
                    { name: '🎯 In-Game', value: player.name || 'N/A', inline: true }
                )
                .setDescription('✅ Conta desvinculada com sucesso.\n⚠️ Removido da whitelist.')
                .setFooter({ text: `Ação realizada por ${interaction.user.tag}` })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

            console.log(`[ADMIN] ${interaction.user.tag} desvinculou Steam ID ${steamId}`);
        } catch (error) {
            console.error('Erro ao desvincular:', error);
            await interaction.editReply('❌ Erro ao desvincular conta.');
        }
    }
};
