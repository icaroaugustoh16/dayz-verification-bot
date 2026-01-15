const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, PermissionFlagsBits } = require('discord.js');
const coinPackages = require('../config/coin-packages.json');
const { formatCurrency } = require('../utils/mercadopago');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setup-loja')
        .setDescription('[ADMIN] Envia o painel da loja de coins no canal atual')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(option =>
            option.setName('imagem')
                .setDescription('URL da imagem de banner (opcional)')
                .setRequired(false)),
    
    async execute(interaction, db) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const imagem = interaction.options.getString('imagem') || 'https://cdn.discordapp.com/attachments/1037080854951899247/1422668119331307610/APOCALYPSE_TAMANHO_DISCORD_1920X1080.png';
            
            // Criar embed principal
            const lojaEmbed = new EmbedBuilder()
                .setColor('#FF4444')
                .setTitle('🛒 LOJA DE COINS - SOBREVIVA COM ESTILO')
                .setDescription(
                    '**Em um mundo pós-apocalíptico, recursos são poder.**\n' +
                    'Garanta sua vantagem. Domine o Apocalypse.\n\n' +
                    '```ansi\n' +
                    '\x1b[1;33m⚡ CRÉDITO INSTANTÂNEO • 🔥 SISTEMA AUTOMATIZADO • 🎁 BÔNUS PROGRESSIVOS\n' +
                    '```\n' +
                    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n' +
                    '**💳 FORMAS DE PAGAMENTO:**\n' +
                    '> **PIX** → Pague e receba em **segundos**. QR Code gerado na hora.\n' +
                    '> **Cartão de Crédito** → Parcelamento disponível. Aprovação imediata.\n' +
                    '> **Mercado Pago** → Plataforma 100% segura e confiável.\n\n' +
                    '**⚙️ PROCESSO AUTOMATIZADO:**\n' +
                    '`1.` Escolha seu pacote abaixo\n' +
                    '`2.` Selecione o servidor de destino (FullMod ou Vanilla)\n' +
                    '`3.` Pague via PIX ou Cartão\n' +
                    '`4.` Coins creditados **automaticamente**\n' +
                    '`5.` Entre no servidor e use: **Tecla "i"**\n\n' +
                    '**🎯 POR QUE COMPRAR?**\n' +
                    '• Acesso facilitado a itens raros do mapa\n' +
                    '• Armas, veículos e equipamentos raros\n' +
                    '• Vantagem competitiva no PvP\n' +
                    '• Construa sua base mais rápido\n\n' +
                    '*Apoie o servidor e receba recompensas épicas.*'
                )
                .setImage(imagem)
                .setFooter({ text: '🔒 Pagamentos via Mercado Pago • Transações 100% Seguras • Suporte 24/7' })
                .setTimestamp();

            // Adicionar fields com os pacotes
            let packagesText = '```ansi\n';
            coinPackages.packages.forEach((pkg, index) => {
                const total = pkg.coins + pkg.bonus;
                const bonusText = pkg.bonus > 0 ? `\x1b[1;32m+${pkg.bonus} BÔNUS\x1b[0m` : '';
                const separator = index < coinPackages.packages.length - 1 ? '├─' : '└─';
                
                packagesText += `${separator} ${pkg.emoji} ${pkg.name.toUpperCase()}\n`;
                packagesText += `│  \x1b[1;33m${formatCurrency(pkg.price)}\x1b[0m │ ${total} coins ${bonusText}\n`;
                if (index < coinPackages.packages.length - 1) packagesText += '│\n';
            });
            packagesText += '```';

            lojaEmbed.addFields({
                name: '⚔️ PACOTES DE SOBREVIVÊNCIA',
                value: packagesText.trim(),
                inline: false
            });

            // Criar select menu com os pacotes
            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('select_coin_package')
                .setPlaceholder('📦 Selecione o pacote que deseja adquirir')
                .setMinValues(1)
                .setMaxValues(1);

            // Adicionar opções ao select menu
            coinPackages.packages.forEach(pkg => {
                const total = pkg.coins + pkg.bonus;
                const bonusLabel = pkg.bonus > 0 ? ` (+${pkg.bonus} BÔNUS)` : '';
                
                selectMenu.addOptions(
                    new StringSelectMenuOptionBuilder()
                        .setLabel(`${pkg.name} - ${formatCurrency(pkg.price)}`)
                        .setDescription(`${total} coins total${bonusLabel} • ${pkg.description}`)
                        .setValue(pkg.id)
                        .setEmoji(pkg.emoji)
                );
            });

            const row = new ActionRowBuilder().addComponents(selectMenu);

            // Enviar painel no canal
            await interaction.channel.send({ embeds: [lojaEmbed], components: [row] });

            // Confirmar ao admin
            const confirmEmbed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('✅ Loja de Coins Configurada')
                .setDescription(`O painel da loja foi enviado com sucesso em ${interaction.channel}`)
                .addFields(
                    { name: '📦 Pacotes Disponíveis', value: `${coinPackages.packages.length} pacotes configurados`, inline: true },
                    { name: '💳 Método de Pagamento', value: 'PIX (Mercado Pago)', inline: true },
                    { name: '⚙️ Status', value: 'Sistema Ativo', inline: true }
                )
                .setFooter({ text: `Configurado por ${interaction.user.tag}` })
                .setTimestamp();

            await interaction.editReply({ embeds: [confirmEmbed] });

            console.log(`[SETUP-LOJA] ${interaction.user.tag} configurou loja em #${interaction.channel.name}`);

        } catch (error) {
            console.error('Erro ao configurar loja:', error);
            await interaction.editReply({ 
                content: `❌ Erro ao enviar painel da loja:\n\`\`\`${error.message}\`\`\`` 
            });
        }
    }
};
