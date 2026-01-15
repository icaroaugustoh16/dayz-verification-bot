const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ranking')
        .setDescription('Ver rankings do servidor')
        .addStringOption(option =>
            option.setName('tipo')
                .setDescription('Tipo de ranking')
                .setRequired(true)
                .addChoices(
                    { name: '💀 Kills', value: 'kills' },
                    { name: '⏱️ Tempo Jogado', value: 'playtime' },
                    { name: '💰 Dinheiro', value: 'money' },
                    { name: '📊 K/D Ratio', value: 'kdratio' },
                    { name: '🧟 Zombie Kills', value: 'zombiekills' }
                )),
    
    async execute(interaction, db) {
        const tipo = interaction.options.getString('tipo');
        await interaction.deferReply();

        try {
            let sortField, formatValue, title, emoji;

            switch (tipo) {
                case 'kills':
                    sortField = 'kills';
                    formatValue = (v) => `${v || 0} kills`;
                    title = '💀 Top 10 - Kills';
                    emoji = '🔫';
                    break;
                case 'playtime':
                    sortField = 'playTime';
                    formatValue = (v) => {
                        const totalMinutes = v || 0;
                        const hours = Math.floor(totalMinutes / 60);
                        const minutes = totalMinutes % 60;
                        return `${hours}h${minutes}m`;
                    };
                    title = '⏱️ Top 10 - Tempo Jogado';
                    emoji = '🕐';
                    break;
                case 'money':
                    sortField = 'money';
                    formatValue = (v) => `$${v || 0}`;
                    title = '💰 Top 10 - Dinheiro';
                    emoji = '💵';
                    break;
                case 'kdratio':
                    sortField = 'kdRatio';
                    formatValue = (v, p) => {
                        const kd = p.deaths > 0 ? (p.kills / p.deaths).toFixed(2) : p.kills || 0;
                        return `${kd} (${p.kills || 0}K/${p.deaths || 0}D)`;
                    };
                    title = '📊 Top 10 - K/D Ratio';
                    emoji = '📈';
                    break;
                case 'zombiekills':
                    sortField = 'zombieKills';
                    formatValue = (v) => `${v || 0} zombies`;
                    title = '🧟 Top 10 - Zombie Kills';
                    emoji = '🧟‍♂️';
                    break;
            }

            const players = await db.collection('players')
                .find({ name: { $exists: true, $ne: null } }) // Apenas jogadores que já jogaram
                .sort({ [sortField]: -1 })
                .limit(10)
                .toArray();

            if (players.length === 0) {
                return interaction.editReply('❌ Nenhum jogador encontrado.');
            }

            const emojis = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
            
            let description = '';
            players.forEach((player, index) => {
                const value = formatValue(player[sortField], player);
                description += `${emojis[index]} **${player.name}** - ${value}\n`;
            });

            const embed = new EmbedBuilder()
                .setColor('#ffd700')
                .setTitle(title)
                .setDescription(description)
                .setFooter({ text: `Atualizado em tempo real • Total de jogadores: ${await db.collection('players').countDocuments()}` })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('Erro ao buscar ranking:', error);
            await interaction.editReply('❌ Erro ao buscar ranking.');
        }
    }
};
