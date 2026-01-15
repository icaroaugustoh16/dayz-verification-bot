const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('player')
        .setDescription('Ver informações de um jogador')
        .addStringOption(option =>
            option.setName('steamid')
                .setDescription('Steam ID do jogador')
                .setRequired(true)),
    
    async execute(interaction, db) {
        const steamId = interaction.options.getString('steamid');

        if (!/^\d{17}$/.test(steamId)) {
            return interaction.reply({ 
                content: '❌ Steam ID inválido! Deve ter 17 dígitos.', 
                ephemeral: true 
            });
        }

        await interaction.deferReply();

        try {
            const player = await db.collection('players').findOne({ steamId });

            if (!player) {
                return interaction.editReply('❌ Jogador não encontrado no banco de dados.');
            }

            // Calcular K/D
            const kdRatio = player.deaths > 0 
                ? (player.kills / player.deaths).toFixed(2) 
                : player.kills;

            // Calcular tempo jogado com horas e minutos
            const totalMinutes = player.playTime || 0;
            const playTimeHours = Math.floor(totalMinutes / 60);
            const playTimeMinutes = totalMinutes % 60;
            const playTimeFormatted = `${playTimeHours}h${playTimeMinutes}m`;

            // Calcular rank (posição no ranking por kills)
            const playersAbove = await db.collection('players')
                .countDocuments({ kills: { $gt: player.kills || 0 } });
            const playerRank = playersAbove + 1;

            // Status online (verifica se lastLogin foi nos últimos 5 minutos)
            const isOnline = player.lastLogin && (Date.now() - new Date(player.lastLogin).getTime()) < 300000; // 5 minutos
            const onlineStatus = isOnline ? '🟢 Online' : '🔴 Offline';

            const embed = new EmbedBuilder()
                .setColor(isOnline ? '#00ff00' : '#808080')
                .setTitle(`🎮 ${player.name || 'Jogador Desconhecido'}`)
                .setDescription(`**Status:** ${onlineStatus}`)
                .addFields(
                    { name: '👤 Discord', value: player.discordTag || 'Não vinculado', inline: true },
                    { name: '✅ Verificado', value: player.verified ? '✅ Sim' : '❌ Não', inline: true },
                    { name: '\u200b', value: '\u200b', inline: true }, // Spacer
                    { name: '💀 Kills', value: `${player.kills || 0}`, inline: true },
                    { name: '☠️ Mortes', value: `${player.deaths || 0}`, inline: true },
                    { name: '📊 K/D', value: `${kdRatio}`, inline: true },
                    { name: '🧟 Zombie Kills', value: `${player.zombieKills || 0}`, inline: true },
                    { name: '🎯 Kill + Longo', value: `${player.longestKill || 0}m`, inline: true },
                    { name: '⏱️ Tempo Jogado', value: playTimeFormatted, inline: true },
                    { name: '💰 Dinheiro', value: `$${player.money || 10000}`, inline: true },
                    { name: '🏆 Rank', value: `#${playerRank}`, inline: true }
                )
                .setFooter({ text: `Último login: ${player.lastLogin ? new Date(player.lastLogin).toLocaleString('pt-BR') : 'Nunca'}` })
                .setTimestamp();

            if (player.discordId) {
                const user = await interaction.client.users.fetch(player.discordId).catch(() => null);
                if (user) {
                    embed.setThumbnail(user.displayAvatarURL());
                }
            }

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('Erro ao buscar jogador:', error);
            await interaction.editReply('❌ Erro ao buscar informações do jogador.');
        }
    }
};
