const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('admin-status')
        .setDescription('[ADMIN] Verifica status do sistema de verificação')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    
    async execute(interaction, db) {
        await interaction.deferReply({ ephemeral: true });

        try {
            // Verificar MongoDB
            const mongoStatus = db ? '✅ Conectado' : '❌ Desconectado';
            let dbStats = null;
            
            if (db) {
                try {
                    const playersCount = await db.collection('players').countDocuments();
                    const verifiedCount = await db.collection('players').countDocuments({ verified: true });
                    const launcherVerifiedCount = await db.collection('players').countDocuments({ launcherVerified: true });
                    const fullyVerifiedCount = await db.collection('players').countDocuments({ 
                        verified: true, 
                        launcherVerified: true,
                        guid: { $ne: "pending", $exists: true }
                    });
                    const pendingCodes = await db.collection('verification_codes').countDocuments();

                    dbStats = {
                        playersCount,
                        verifiedCount,
                        launcherVerifiedCount,
                        fullyVerifiedCount,
                        pendingCodes
                    };
                } catch (error) {
                    console.error('Erro ao buscar stats:', error);
                }
            }

            // Verificar variáveis de ambiente
            const envVars = [
                { name: 'DISCORD_TOKEN', value: process.env.DISCORD_TOKEN ? '✅ Definido' : '❌ Ausente' },
                { name: 'CLIENT_ID', value: process.env.CLIENT_ID ? '✅ Definido' : '❌ Ausente' },
                { name: 'GUILD_ID', value: process.env.GUILD_ID ? '✅ Definido' : '❌ Ausente' },
                { name: 'MONGO_URL', value: process.env.MONGO_URL ? '✅ Definido' : '❌ Ausente' },
                { name: 'VERIFICATION_URL', value: process.env.VERIFICATION_URL ? `✅ ${process.env.VERIFICATION_URL}` : '❌ Ausente' },
                { name: 'ROLE_VERIFIED', value: process.env.ROLE_VERIFIED ? `✅ ${process.env.ROLE_VERIFIED}` : '❌ Ausente' },
                { name: 'WHITELIST_PATH', value: process.env.WHITELIST_PATH ? '✅ Definido' : '❌ Ausente' },
                { name: 'COINS_DATA_DIR', value: process.env.COINS_DATA_DIR ? '✅ Definido' : '⚠️ Não configurado' },
                { name: 'COINS_LOG_CHANNEL', value: process.env.COINS_LOG_CHANNEL ? '✅ Definido' : '⚠️ Não configurado' }
            ];

            // Verificar cargo verificado
            let roleStatus = '⚠️ Não verificado';
            try {
                const guild = await interaction.client.guilds.fetch(process.env.GUILD_ID);
                const verifiedRole = guild.roles.cache.get(process.env.ROLE_VERIFIED);
                
                if (verifiedRole) {
                    roleStatus = `✅ Encontrado: @${verifiedRole.name}`;
                } else {
                    roleStatus = '❌ Cargo não encontrado no servidor';
                }
            } catch (error) {
                roleStatus = '❌ Erro ao verificar';
            }

            const embed = new EmbedBuilder()
                .setColor('#3498db')
                .setTitle('🔧 Status do Sistema de Verificação')
                .setDescription('Diagnóstico completo do sistema')
                .addFields(
                    { 
                        name: '💾 MongoDB', 
                        value: mongoStatus, 
                        inline: true 
                    },
                    { 
                        name: '🤖 Bot', 
                        value: `✅ Online\n👤 ${interaction.client.user.tag}`, 
                        inline: true 
                    },
                    { 
                        name: '🏷️ Cargo Verificado', 
                        value: roleStatus, 
                        inline: true 
                    }
                );

            if (dbStats) {
                embed.addFields({
                    name: '📊 Estatísticas do Banco',
                    value: `**Total de Players:** ${dbStats.playersCount}\n` +
                           `**Discord Verificado:** ${dbStats.verifiedCount}\n` +
                           `**Launcher Verificado:** ${dbStats.launcherVerifiedCount}\n` +
                           `**Totalmente Verificado:** ${dbStats.fullyVerifiedCount}\n` +
                           `**Códigos Pendentes:** ${dbStats.pendingCodes}`,
                    inline: false
                });
            }

            embed.addFields({
                name: '⚙️ Variáveis de Ambiente',
                value: envVars.map(v => `**${v.name}:** ${v.value}`).join('\n'),
                inline: false
            });

            // Últimas verificações
            if (db) {
                try {
                    const recentVerifications = await db.collection('players')
                        .find({ verified: true })
                        .sort({ verifiedAt: -1 })
                        .limit(5)
                        .toArray();

                    if (recentVerifications.length > 0) {
                        const recentList = recentVerifications.map(p => 
                            `• ${p.discordTag || 'N/A'} - \`${p.steamId}\` - ${new Date(p.verifiedAt).toLocaleString('pt-BR')}`
                        ).join('\n');

                        embed.addFields({
                            name: '📜 Últimas 5 Verificações',
                            value: recentList,
                            inline: false
                        });
                    }
                } catch (error) {
                    console.error('Erro ao buscar verificações recentes:', error);
                }
            }

            embed.setFooter({ text: `Requisitado por ${interaction.user.tag}` })
                 .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Erro ao gerar status:', error);
            await interaction.editReply({ 
                content: `❌ Erro ao gerar relatório:\n\`\`\`${error.message}\`\`\`` 
            });
        }
    }
};
