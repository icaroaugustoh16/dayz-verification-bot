const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');
const path = require('path');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('coins-add')
        .setDescription('[ADMIN] Adicionar coins para um jogador')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption(option =>
            option.setName('jogador')
                .setDescription('Mencione o jogador no Discord')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('quantidade')
                .setDescription('Quantidade de coins')
                .setRequired(true)
                .setMinValue(1))
        .addStringOption(option =>
            option.setName('motivo')
                .setDescription('Motivo da adição de coins')
                .setRequired(false)),
    
    async execute(interaction, db) {
        const jogador = interaction.options.getUser('jogador');
        const quantidade = interaction.options.getInteger('quantidade');
        const motivo = interaction.options.getString('motivo') || 'Adicionado por administrador';
        const admin = interaction.member.nickname || interaction.user.username;

        await interaction.deferReply({ ephemeral: true });

        try {
            // Buscar jogador no banco de dados
            const player = await db.collection('players').findOne({ discordId: jogador.id });

            if (!player) {
                return interaction.editReply('❌ Jogador não tem nenhuma conta verificada no servidor.');
            }

            if (!player.steamId) {
                return interaction.editReply('❌ Jogador não possui Steam ID vinculado.');
            }

            const steamId = player.steamId;
            const playerDataDir = process.env.COINS_DATA_DIR || 'C:\\DayZServer1.28_TESTE\\DayZServerModded_TESTE\\Profiles\\ModsSparda\\Store\\PlayerAccounts';
            const playerDataPath = path.join(playerDataDir, `${steamId}.json`);

            // Criar diretório se não existir
            if (!fs.existsSync(playerDataDir)) {
                fs.mkdirSync(playerDataDir, { recursive: true });
            }

            let playerData;
            if (fs.existsSync(playerDataPath)) {
                const rawData = fs.readFileSync(playerDataPath, 'utf8');
                playerData = JSON.parse(rawData);
            } else {
                // Criar arquivo inicial (formato exato do mod)
                playerData = {
                    steamid: steamId,
                    coins: 0
                };
            }

            const saldoAnterior = parseInt(playerData.coins) || 0;
            playerData.coins = saldoAnterior + quantidade;

            // Garantir que steamid está no formato correto
            playerData.steamid = steamId;

            // Salvar arquivo atualizado (formato exato do mod)
            fs.writeFileSync(playerDataPath, JSON.stringify(playerData, null, 4), 'utf8');

            // Log no MongoDB
            await db.collection('logs').insertOne({
                type: 'coins_add',
                steamId: steamId,
                discordId: jogador.id,
                playerName: player.name || jogador.username,
                quantidade: quantidade,
                saldoAnterior: saldoAnterior,
                novoSaldo: playerData.coins,
                motivo: motivo,
                admin: interaction.user.tag,
                timestamp: new Date()
            });

            // Embed para log público
            const logChannelId = process.env.COINS_LOG_CHANNEL || process.env.CHANNEL_LOGS;
            const logChannel = interaction.client.channels.cache.get(logChannelId);

            if (logChannel) {
                const logEmbed = new EmbedBuilder()
                    .setColor('#00ff00')
                    .setTitle('💰 Coins Adicionados')
                    .addFields(
                        { name: '👤 Jogador', value: `${player.name || jogador.username}`, inline: true },
                        { name: '💬 Discord', value: `${jogador.tag}`, inline: true },
                        { name: '🆔 Steam ID', value: `\`${steamId}\``, inline: false },
                        { name: '💵 Quantidade', value: `**+${quantidade}** coins`, inline: true },
                        { name: '💸 Saldo Anterior', value: `${saldoAnterior} coins`, inline: true },
                        { name: '✅ Novo Saldo', value: `**${playerData.coins} coins**`, inline: true },
                        { name: '📝 Motivo', value: motivo, inline: false },
                        { name: '👮 Administrador', value: admin, inline: true }
                    )
                    .setTimestamp()
                    .setFooter({ text: 'Sistema de Coins - DayZ Apocalypse' });

                await logChannel.send({ embeds: [logEmbed] });
            }

            // Notificar jogador via DM
            try {
                const dmEmbed = new EmbedBuilder()
                    .setColor('#ffd700')
                    .setTitle('🎉 Você Recebeu Coins!')
                    .setDescription('Obrigado por fazer parte do nosso servidor!')
                    .addFields(
                        { name: '💰 Quantidade Recebida', value: `**+${quantidade} coins**`, inline: true },
                        { name: '💸 Novo Saldo', value: `**${playerData.coins} coins**`, inline: true },
                        { name: '📝 Motivo', value: motivo, inline: false }
                    )
                    .setTimestamp()
                    .setFooter({ text: 'DayZ Apocalypse - Sistema de Coins' });

                await jogador.send({ embeds: [dmEmbed] });
            } catch (err) {
                console.log(`[COINS] Não foi possível enviar DM para ${jogador.tag}`);
            }

            await interaction.editReply({
                content: `✅ **${quantidade} coins** adicionados para **${player.name || jogador.username}**!\n` +
                         `💸 Novo saldo: **${playerData.coins} coins**`
            });

        } catch (error) {
            console.error('Erro ao adicionar coins:', error);
            await interaction.editReply('❌ Erro ao adicionar coins. Verifique os logs.');
        }
    }
};
