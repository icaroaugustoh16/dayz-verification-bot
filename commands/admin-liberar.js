const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');
const { addToWhitelist } = require('../utils/whitelist.js');
const { addCoins } = require('../utils/coins.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('admin-liberar')
        .setDescription('[ADMIN] Liberar verificação manual (Discord + Launcher + Whitelist)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(option =>
            option.setName('steamid')
                .setDescription('Steam ID para liberar')
                .setRequired(true))
        .addUserOption(option =>
            option.setName('usuario')
                .setDescription('Usuário do Discord para vincular')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('nickname')
                .setDescription('Nickname in-game do jogador')
                .setRequired(false)),
    
    async execute(interaction, db) {
        const steamId = interaction.options.getString('steamid');
        const user = interaction.options.getUser('usuario');
        const nickname = interaction.options.getString('nickname');

        if (!/^\d{17}$/.test(steamId)) {
            return interaction.reply({ 
                content: '❌ Steam ID inválido! Deve ter 17 dígitos.', 
                ephemeral: true 
            });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            // Verificar se já existe
            let player = await db.collection('players').findOne({ steamId });

            const updateData = {
                verified: true,
                launcherVerified: true,
                guid: player?.guid || "pending",
                verifiedAt: new Date(),
                launcherVerifiedAt: new Date(),
                manualVerification: true,
                manualVerifiedBy: interaction.user.id,
                manualVerifiedAt: new Date()
            };

            // Se forneceu usuário Discord
            if (user) {
                updateData.discordId = user.id;
                updateData.discordTag = user.tag;

                // Dar cargo verificado
                try {
                    const guild = await interaction.client.guilds.fetch(process.env.GUILD_ID);
                    const member = await guild.members.fetch(user.id);
                    const verifiedRole = guild.roles.cache.get(process.env.ROLE_VERIFIED);

                    if (member && verifiedRole) {
                        await member.roles.add(verifiedRole);
                        console.log(`✅ Cargo verificado dado para ${user.tag}`);
                    }
                } catch (error) {
                    console.error('❌ Erro ao dar cargo:', error.message);
                }
            }

            // Se forneceu nickname
            if (nickname) {
                updateData.name = nickname;
                updateData.nickname = nickname;
            }

            // Atualizar ou criar no banco
            if (player) {
                await db.collection('players').updateOne(
                    { steamId },
                    { $set: updateData }
                );
            } else {
                // Criar novo registro
                await db.collection('players').insertOne({
                    steamId,
                    ...updateData,
                    firstJoin: new Date(),
                    kills: 0,
                    deaths: 0,
                    zombieKills: 0,
                    money: 0,
                    playTime: 0
                });
            }

            // Adicionar à whitelist
            addToWhitelist(steamId, user?.tag || nickname || steamId);

            // Recarregar player atualizado
            player = await db.collection('players').findOne({ steamId });

            const embed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('✅ Verificação Manual Concedida')
                .setDescription(`**Steam ID:** \`${steamId}\``)
                .addFields(
                    { name: '👤 Discord', value: user ? `${user.tag} (\`${user.id}\`)` : 'Não vinculado', inline: true },
                    { name: '🎯 Nickname', value: nickname || player?.name || 'Não definido', inline: true },
                    { name: '🔑 GUID', value: `\`${player?.guid || 'pending'}\``, inline: false },
                    { name: '✅ Status', value: '**Discord:** ✅ Verificado\n**Launcher:** ✅ Verificado\n**Whitelist:** ✅ Adicionado', inline: false }
                )
                .setFooter({ text: `Liberado por ${interaction.user.tag}` })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

            // Log no console
            console.log(`[ADMIN-LIBERAR] ${interaction.user.tag} liberou Steam ID ${steamId}${user ? ` para ${user.tag}` : ''}`);

            // Enviar para canal de logs se configurado
            try {
                const logChannelId = process.env.CHANNEL_LOGS;
                if (logChannelId) {
                    const logChannel = await interaction.client.channels.fetch(logChannelId);
                    if (logChannel) {
                        const publicEmbed = new EmbedBuilder()
                            .setColor('#00ff00')
                            .setTitle('🔓 Verificação Manual Concedida')
                            .addFields(
                                { name: '🆔 Steam ID', value: `\`${steamId}\``, inline: false },
                                { name: '👤 Discord', value: user ? user.tag : 'Não vinculado', inline: true },
                                { name: '🎯 Nickname', value: nickname || 'N/A', inline: true },
                                { name: '👮 Admin', value: interaction.user.tag, inline: true }
                            )
                            .setTimestamp();

                        await logChannel.send({ embeds: [publicEmbed] });
                    }
                }
            } catch (error) {
                console.error('Erro ao enviar log público:', error.message);
            }

        } catch (error) {
            console.error('Erro ao liberar verificação:', error);
            await interaction.editReply(`❌ Erro ao liberar verificação:\n\`\`\`${error.message}\`\`\``);
        }
    }
};
