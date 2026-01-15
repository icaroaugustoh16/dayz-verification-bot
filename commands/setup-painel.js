const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setup-painel')
        .setDescription('[ADMIN] Envia o painel de verificação no canal atual')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(option =>
            option.setName('titulo')
                .setDescription('Título personalizado (opcional)')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('descricao')
                .setDescription('Descrição personalizada (opcional)')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('imagem')
                .setDescription('URL da imagem (opcional)')
                .setRequired(false)),
    
    async execute(interaction, db) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const titulo = interaction.options.getString('titulo') || '✅ Sistema de Verificação de Conta';
            const descricao = interaction.options.getString('descricao') || 'Para ter acesso completo ao servidor e poder jogar, siga os passos abaixo.';
            const imagem = interaction.options.getString('imagem') || 'https://cdn.discordapp.com/attachments/1037080854951899247/1422668119331307610/APOCALYPSE_TAMANHO_DISCORD_1920X1080.png';
            
            const verifyUrl = `${process.env.VERIFICATION_URL || 'http://localhost:3002'}/verify`;

            const setupEmbed = new EmbedBuilder()
                .setColor('#ff0000')
                .setTitle(titulo)
                .setDescription(descricao)
                .addFields(
                    { 
                        name: '1️⃣ Inicie a Verificação', 
                        value: 'Clique no botão **"Verificar com a Steam"** para ser direcionado ao nosso site de verificação segura e fazer login com sua conta Steam.',
                        inline: false
                    },
                    { 
                        name: '2️⃣ Receba seu Código', 
                        value: 'Após o login, você receberá um código de uso único na tela.',
                        inline: false
                    },
                    { 
                        name: '3️⃣ Finalize a Verificação', 
                        value: 'Clique no botão **"Finalizar Verificação"** aqui no Discord, cole o código recebido e clique em "Enviar".',
                        inline: false
                    }
                )
                .setImage(imagem)
                .setFooter({ text: 'DayZ Apocalypse Protect' })
                .setTimestamp();

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setLabel('Verificar com a Steam')
                        .setStyle(ButtonStyle.Link)
                        .setEmoji('🔗')
                        .setURL(verifyUrl),
                    new ButtonBuilder()
                        .setCustomId('open_verify_modal')
                        .setLabel('Finalizar Verificação')
                        .setStyle(ButtonStyle.Success)
                        .setEmoji('✅')
                );

            // Enviar painel no canal
            await interaction.channel.send({ embeds: [setupEmbed], components: [row] });

            // Confirmar ao admin
            const confirmEmbed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('✅ Painel de Verificação Enviado')
                .setDescription(`O painel foi enviado com sucesso em ${interaction.channel}`)
                .addFields(
                    { name: '🔗 URL de Verificação', value: `\`${verifyUrl}\``, inline: false },
                    { name: '📋 Configuração', value: `**Título:** ${titulo}\n**Descrição:** ${descricao.substring(0, 100)}...`, inline: false }
                )
                .setFooter({ text: `Configurado por ${interaction.user.tag}` })
                .setTimestamp();

            await interaction.editReply({ embeds: [confirmEmbed] });

            console.log(`[SETUP-PAINEL] ${interaction.user.tag} configurou painel em #${interaction.channel.name}`);

        } catch (error) {
            console.error('Erro ao configurar painel:', error);
            await interaction.editReply({ 
                content: `❌ Erro ao enviar painel:\n\`\`\`${error.message}\`\`\`` 
            });
        }
    }
};
