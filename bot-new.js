require('dotenv').config();
const { Client, GatewayIntentBits, Collection, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');

// Criar cliente Discord com intents necessários
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

// Coleção para armazenar comandos
client.commands = new Collection();

// Variável global para o banco de dados
let db;

// Armazenar interações ativas de pagamento PIX (para editar depois)
const activePaymentInteractions = new Map();

// Limpar interações antigas a cada 30 minutos
setInterval(() => {
    const now = Date.now();
    const THIRTY_MINUTES = 30 * 60 * 1000;
    
    let cleaned = 0;
    for (const [paymentId, data] of activePaymentInteractions.entries()) {
        if (now - data.createdAt > THIRTY_MINUTES) {
            activePaymentInteractions.delete(paymentId);
            cleaned++;
        }
    }
    
    if (cleaned > 0) {
        console.log(`🗑️ [CLEANUP] ${cleaned} interação(ões) removida(s) por timeout | ${activePaymentInteractions.size} ativa(s)`);
    }
}, 30 * 60 * 1000); // Rodar a cada 30 minutos

/**
 * Envia logs de erro para o canal de logs do Discord
 * @param {string} errorTitle - Título do erro
 * @param {Error} error - Objeto de erro
 * @param {object} context - Contexto adicional (usuário, ação, etc)
 */
async function sendErrorLog(errorTitle, error, context = {}) {
    try {
        const WEBHOOK_LOGS = process.env.WEBHOOK_LOGS;
        if (!WEBHOOK_LOGS) {
            console.warn('[ERROR LOG] WEBHOOK_LOGS não configurado, pulando envio para Discord');
            return;
        }

        const axios = require('axios');

        const errorEmbed = {
            title: `🚨 ${errorTitle}`,
            description: `\`\`\`${error.message}\`\`\``,
            color: 0xE74C3C, // Vermelho
            fields: [],
            timestamp: new Date().toISOString()
        };

        // Adicionar contexto se fornecido
        if (context.userId) {
            errorEmbed.fields.push({ name: '👤 Usuário', value: `<@${context.userId}>`, inline: true });
        }
        if (context.userTag) {
            errorEmbed.fields.push({ name: '🏷️ Tag', value: context.userTag, inline: true });
        }
        if (context.steamId) {
            errorEmbed.fields.push({ name: '🆔 Steam ID', value: `\`${context.steamId}\``, inline: true });
        }
        if (context.action) {
            errorEmbed.fields.push({ name: '⚙️ Ação', value: context.action, inline: true });
        }
        if (context.packageId) {
            errorEmbed.fields.push({ name: '📦 Pacote', value: context.packageId, inline: true });
        }
        if (context.serverType) {
            errorEmbed.fields.push({ name: '🎮 Servidor', value: context.serverType, inline: true });
        }

        // Stack trace (limitado a 1000 caracteres)
        if (error.stack) {
            const stackTrace = error.stack.substring(0, 1000);
            errorEmbed.fields.push({
                name: '📋 Stack Trace',
                value: `\`\`\`${stackTrace}\`\`\``,
                inline: false
            });
        }

        errorEmbed.footer = { text: 'Sistema de Erro Automático' };

        await axios.post(WEBHOOK_LOGS, {
            embeds: [errorEmbed]
        });

        console.log(`✅ [ERROR LOG] Erro enviado para Discord: ${errorTitle}`);
    } catch (logError) {
        console.error('[ERROR LOG] Falha ao enviar erro para Discord:', logError.message);
    }
}

// Carregar comandos da pasta commands/
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    
    if ('data' in command && 'execute' in command) {
        client.commands.set(command.data.name, command);
    } else {
        console.log(`⚠️ Aviso: O comando em ${file} está faltando "data" ou "execute"`);
    }
}

// Conectar ao MongoDB
async function connectDatabase() {
    try {
        const mongoClient = new MongoClient(process.env.MONGO_URL || process.env.MONGO_URI);
        await mongoClient.connect();
        db = mongoClient.db(process.env.DATABASE_NAME || process.env.DB_NAME || 'dayz_server');
    } catch (error) {
        console.error('❌ Erro ao conectar ao MongoDB:', error);
        process.exit(1);
    }
}

// Evento: Bot pronto
client.once('ready', async () => {
    // Conectar ao banco de dados
    await connectDatabase();
    
    console.log(`✅ Bot: ${client.user.tag} | Comandos: ${client.commands.size} | MongoDB: ${db.databaseName}`);
    
    // ===== VALIDAÇÃO CRÍTICA DE PRODUÇÃO =====
    const isProduction = process.env.NODE_ENV === 'production';
    const mpToken = process.env.MERCADOPAGO_ACCESS_TOKEN || '';
    
    if (isProduction && mpToken.includes('TEST')) {
        console.error('\n🚨 [CRÍTICO] Usando credenciais TEST em ambiente PRODUCTION!');
        console.error('⚠️  Altere MERCADOPAGO_ACCESS_TOKEN para credenciais de produção!');
        console.error('⚠️  NODE_ENV está definido como: production\n');
    }
    
    if (!process.env.COINS_DATA_DIR) {
        console.error('\n🚨 [CRÍTICO] COINS_DATA_DIR não configurado no .env!');
        console.error('⚠️  Defina o caminho para a pasta PlayerAccounts do mod\n');
    }
    
    if (!process.env.WEBHOOK_PURCHASES) {
        console.warn('⚠️  [AVISO] WEBHOOK_PURCHASES não configurado (logs de compras desabilitados)');
    }
    
    if (!process.env.WEBHOOK_FRAUDS) {
        console.warn('⚠️  [AVISO] WEBHOOK_FRAUDS não configurado (alertas de fraude desabilitados)');
    }
    
    console.log(`\n🔧 Ambiente: ${isProduction ? '🔴 PRODUCTION' : '🟡 DEVELOPMENT'}`);
    console.log(`💳 Mercado Pago: ${mpToken.includes('TEST') ? '🧪 TEST' : '✅ PRODUCTION'}\n`);
    
    // Iniciar webhook server do Mercado Pago
    try {
        const { startWebhookServer, setDiscordClient, setDatabase, paymentEvents } = require('./mercadopago-webhook');
        setDiscordClient(client);
        setDatabase(db);
        
        // Listener para quando pagamento for aprovado
        paymentEvents.on('paymentApproved', async (paymentData) => {
            try {
                console.log(`[BOT] Recebido evento de pagamento aprovado: ${paymentData.paymentId}`);
                
                // Buscar interação ativa
                const interactionData = activePaymentInteractions.get(paymentData.paymentId.toString());
                
                if (interactionData) {
                    const { interaction, packageInfo, createdAt } = interactionData;
                    
                    // Verificar se interação não expirou (Discord expira após 15 minutos)
                    const age = Date.now() - createdAt;
                    if (age > 14 * 60 * 1000) { // 14 minutos (margem de segurança)
                        console.warn(`⚠️ [BOT] Interação expirou (${Math.floor(age/60000)}min), enviando DM`);
                        activePaymentInteractions.delete(paymentData.paymentId.toString());
                        // Continua para enviar DM abaixo
                        return;
                    }
                    
                    // Criar embed de aprovação
                    const successEmbed = new EmbedBuilder()
                        .setColor('#00FF00')
                        .setTitle('✅ Pagamento Aprovado!')
                        .setDescription(
                            `**Obrigado pela sua compra!**\n\n` +
                            `💰 **+${paymentData.totalCoins} coins** foram adicionados à sua conta!\n\n` +
                            `**Saldo atual: ${paymentData.newBalance} coins**`
                        )
                        .addFields(
                            { 
                                name: '📦 Pacote Adquirido', 
                                value: `${packageInfo.name}`, 
                                inline: true 
                            },
                            { 
                                name: '💵 Valor Pago', 
                                value: `R$ ${paymentData.amount.toFixed(2)}`, 
                                inline: true 
                            },
                            { 
                                name: '🪙 Detalhes', 
                                value: `Coins: ${paymentData.coins}\nBônus: ${paymentData.bonus}\n**Total: ${paymentData.totalCoins} coins**`, 
                                inline: false 
                            },
                            {
                                name: '🎮 Como Usar',
                                value: 'Entre no servidor e pressione **"i"** para abrir a loja in-game!',
                                inline: false
                            }
                        )
                        .setFooter({ text: `ID da Transação: ${paymentData.paymentId}` })
                        .setTimestamp();
                    
                    // Editar mensagem ephemeral original
                    await interaction.editReply({
                        content: null,
                        embeds: [successEmbed],
                        components: [],
                        files: []
                    });
                    
                    console.log(`✅ [BOT] Mensagem ephemeral editada para pagamento ${paymentData.paymentId}`);
                    
                    // Remover da lista de interações ativas
                    activePaymentInteractions.delete(paymentData.paymentId.toString());
                    console.log(`🗑️ [BOT] Interação removida da memória (${activePaymentInteractions.size} ativas restantes)`);
                } else {
                    console.log(`⚠️ [BOT] Interação não encontrada para pagamento ${paymentData.paymentId}`);
                }
            } catch (error) {
                console.error('[BOT] Erro ao editar mensagem ephemeral:', error);
            }
        });
        
        startWebhookServer();
    } catch (error) {
        console.error('⚠️ Erro ao iniciar webhook server:', error.message);
    }
});

// Evento: Interações (Slash Commands)
client.on('interactionCreate', async interaction => {
    // Slash Commands
    if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);

        if (!command) {
            console.error(`❌ Comando não encontrado: ${interaction.commandName}`);
            return;
        }

        try {
            console.log(`📝 Executando comando: /${interaction.commandName} por ${interaction.user.tag}`);
            await command.execute(interaction, db);
        } catch (error) {
            console.error(`❌ Erro ao executar comando /${interaction.commandName}:`, error);

            // Enviar log de erro para Discord
            await sendErrorLog(`Erro ao executar comando /${interaction.commandName}`, error, {
                userId: interaction.user.id,
                userTag: interaction.user.tag,
                action: `command_${interaction.commandName}`
            });

            const errorMessage = {
                content: '❌ Houve um erro ao executar este comando!',
                ephemeral: true
            };

            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(errorMessage);
            } else {
                await interaction.reply(errorMessage);
            }
        }
    }
    
    // ===== BOTÃO: ABRIR MODAL DE VERIFICAÇÃO =====
    if (interaction.isButton() && interaction.customId === 'open_verify_modal') {
        try {
            console.log(`[BOTÃO] ${interaction.user.tag} clicou em "Finalizar Verificação"`);
            
            // Verificar se MongoDB está conectado
            if (!db) {
                console.error('[BOTÃO] MongoDB não está conectado!');
                return interaction.reply({ 
                    content: '❌ Sistema temporariamente indisponível. Tente novamente em alguns segundos.', 
                    ephemeral: true 
                });
            }
            
            const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
            
            const modal = new ModalBuilder()
                .setCustomId('verify_code_modal')
                .setTitle('Finalizar Verificação');

            const codeInput = new TextInputBuilder()
                .setCustomId('codeInput')
                .setLabel("Cole o código que você recebeu no site:")
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setPlaceholder('Ex: A4B8D1');

            const actionRow = new ActionRowBuilder().addComponents(codeInput);
            modal.addComponents(actionRow);

            await interaction.showModal(modal);
        } catch (error) {
            console.error('[BOTÃO] Erro ao abrir modal:', error);
            await interaction.reply({ 
                content: '❌ Erro ao abrir janela de verificação. Contate um administrador.', 
                ephemeral: true 
            });
        }
    }
    
    // ===== MODAL: PROCESSAR CÓDIGO DE VERIFICAÇÃO =====
    if (interaction.isModalSubmit() && interaction.customId === 'verify_code_modal') {
        // Verificar se MongoDB está conectado
        if (!db) {
            console.error('[MODAL] MongoDB não está conectado!');
            return interaction.reply({ 
                content: '❌ Sistema temporariamente indisponível. Tente novamente em alguns segundos.', 
                ephemeral: true 
            });
        }

        await interaction.deferReply({ ephemeral: true });

        const code = interaction.fields.getTextInputValue('codeInput').toUpperCase();
        const discordUser = interaction.user;
        const guild = interaction.guild;

        console.log(`[MODAL] ${discordUser.tag} enviou código: ${code}`);

        try {
            const verificationEntry = await db.collection('verification_codes').findOne({ code });

            if (!verificationEntry) {
                console.log(`[MODAL] Código ${code} não encontrado`);
                return interaction.editReply({ content: '❌ Código inválido ou expirado.' });
            }

            console.log(`[MODAL] Código válido! Steam ID: ${verificationEntry.steamId}`);

            const { steamId, steamName } = verificationEntry;
            
            // Verificar se já está completamente verificado
            const existingPlayer = await db.collection('players').findOne({ steamId: steamId });

            if (existingPlayer && 
                existingPlayer.verified && 
                existingPlayer.launcherVerified && 
                existingPlayer.guid && 
                existingPlayer.guid !== "pending") {
                
                await db.collection('verification_codes').deleteOne({ code });
                
                return interaction.editReply({ 
                    content: `✅ **Esta Steam ID já está completamente verificada!**\n\n` +
                             `📋 **Informações:**\n` +
                             `> Discord: \`${existingPlayer.discordTag}\`\n` +
                             `> Steam ID: \`${steamId}\`\n` +
                             `> GUID: \`${existingPlayer.guid}\`\n` +
                             `> In-Game: \`${existingPlayer.name || 'Não jogou ainda'}\`\n\n` +
                             `🎮 **Você já pode jogar! Apenas abra o launcher e clique em PLAY.**`
                });
            }

            const userAccounts = await db.collection('players').find({ 
                discordId: discordUser.id 
            }).toArray();

            console.log(`[VERIFY] Steam: ${steamId} | Discord: ${discordUser.tag} | Conta #${userAccounts.length + 1}`);
            
            await db.collection('players').updateOne(
                { steamId: steamId },
                {
                    $set: {
                        discordId: discordUser.id,
                        discordTag: discordUser.tag,
                        steamName: steamName,
                        verified: true,
                        verifiedAt: new Date()
                    },
                    $setOnInsert: {
                        steamId: steamId,
                        launcherVerified: false,
                        guid: "pending",
                        firstJoin: new Date(),
                        kills: 0,
                        deaths: 0,
                        zombieKills: 0,
                        longestKill: 0,
                        kdRatio: 0,
                        playTime: 0,
                        online: false,
                        money: 10000,
                        clanId: null,
                        awaitingGuid: false
                    }
                },
                { upsert: true }
            );

            await db.collection('verification_codes').deleteOne({ code });

            // ✅ ADICIONAR À WHITELIST (necessário para player conseguir entrar no servidor)
            try {
                const whitelistPath = process.env.WHITELIST_PATH;
                if (whitelistPath && fs.existsSync(whitelistPath)) {
                    const whitelistContent = fs.readFileSync(whitelistPath, 'utf8');
                    if (!whitelistContent.includes(steamId)) {
                        fs.appendFileSync(whitelistPath, `\n${steamId}\t//${discordUser.tag}`);
                        console.log(`[WHITELIST] ${steamId} adicionado`);
                    } else {
                        console.log(`[WHITELIST] ${steamId} já está na whitelist`);
                    }
                }
            } catch (err) {
                console.error("[WHITELIST] Erro:", err);
            }

            let message = '';
            if (userAccounts.length > 0) {
                message = `✅ **Conta adicional vinculada!**\n\nVocê agora tem **${userAccounts.length + 1} contas** verificadas.\n\n`;
            } else {
                message = `✅ **Primeira conta verificada!**\n\n`;
            }

            // Mensagem padrão: sempre pede pra abrir o launcher
            await interaction.editReply({ 
                content: message + 
                        '🔑 **Discord verificado com sucesso!**\n\n' +
                        '📝 **Próximos passos:**\n' +
                        '1️⃣ Abra o **Launcher** do servidor\n' +
                        '2️⃣ Clique em **PLAY** e entre no servidor\n' +
                        '3️⃣ Aguarde alguns segundos no jogo\n\n' +
                        '🎁 **Bônus automático:** Ao entrar pela primeira vez, você receberá **1325 coins** (R$ 34,90)!\n' +
                        '🏷️ Você também receberá automaticamente o cargo de verificado.\n\n' +
                        '⚠️ **Importante:** Certifique-se de abrir o launcher antes de entrar no servidor.'
            });

        } catch (error) {
            console.error('[MODAL] Erro ao processar verificação:', error);

            // Enviar log de erro para Discord
            await sendErrorLog('Erro ao processar verificação', error, {
                userId: interaction.user.id,
                userTag: interaction.user.tag,
                action: 'modal_verification'
            });

            await interaction.editReply({ content: '❌ Erro ao processar. Contate um administrador.' });
        }
    }

    // ===== SELECT MENU: SELEÇÃO DE PACOTE DE COINS =====
    if (interaction.isStringSelectMenu() && interaction.customId === 'select_coin_package') {
        try {
            const packageId = interaction.values[0];
            console.log(`[LOJA] ${interaction.user.tag} selecionou pacote: ${packageId}`);

            await interaction.deferReply({ ephemeral: true });

            // Carregar dados do pacote
            const coinPackages = require('./config/coin-packages.json');
            const selectedPackage = coinPackages.packages.find(pkg => pkg.id === packageId);

            if (!selectedPackage) {
                return interaction.editReply({ content: '❌ Pacote não encontrado!' });
            }

            // Buscar dados do player no banco
            const player = await db.collection('players').findOne({ discordId: interaction.user.id });

            if (!player) {
                return interaction.editReply({ 
                    content: '❌ **Você precisa estar verificado para comprar coins!**\n\n' +
                             'Use o painel de verificação para vincular sua conta Steam primeiro.' 
                });
            }

            // LOG DETALHADO: Pacote selecionado
            const { sendDetailedLog } = require('./mercadopago-webhook');
            await sendDetailedLog('package_selected', {
                userId: interaction.user.id,
                userTag: interaction.user.tag,
                steamId: player.steamId,
                packageId: selectedPackage.id,
                packageName: selectedPackage.name,
                amount: selectedPackage.price,
                coins: selectedPackage.coins + selectedPackage.bonus,
                player: player
            });

            // Mostrar TERMOS DE SERVIÇO antes do pagamento
            const terms = require('./config/terms-of-service.json');
            const { formatCurrency } = require('./utils/mercadopago');

            const totalCoins = selectedPackage.coins + selectedPackage.bonus;
            const bonusText = selectedPackage.bonus > 0 ? ` + ${selectedPackage.bonus} bônus` : '';
            
            // Buscar saldo REAL do arquivo JSON do mod
            const { getCoins } = require('./utils/coins');
            const currentCoins = getCoins(player.steamId);

            const termsEmbed = new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('⚠️ LEIA ANTES DE COMPRAR')
                .setDescription(
                    `**💰 Seu saldo atual: ${currentCoins} coins**\n\n` +
                    `**Você está prestes a comprar:**\n` +
                    `${selectedPackage.emoji} ${selectedPackage.name} - ${formatCurrency(selectedPackage.price)}\n` +
                    `${totalCoins} coins (${selectedPackage.coins}${bonusText})\n` +
                    `**Novo saldo:** ${currentCoins + totalCoins} coins\n\n` +
                    `**📜 POLÍTICA DE REEMBOLSO:**\n\n` +
                    `❌ **NÃO REALIZAMOS REEMBOLSOS** em casos normais\n\n` +
                    `✅ **Reembolso apenas se:**\n` +
                    `• Erro técnico comprovado\n` +
                    `• Você NÃO gastou nenhum coin\n` +
                    `• Duplicação de pagamento\n\n` +
                    `⚠️ **NÃO damos reembolso se:**\n` +
                    `• Você gastou os coins (mesmo 1 coin)\n` +
                    `• Mudou de ideia\n` +
                    `• Foi banido do servidor\n` +
                    `• Perdeu itens no jogo\n\n` +
                    `🚨 **ESTORNO BANCÁRIO:**\n` +
                    `Se você fizer estorno pelo banco:\n` +
                    `• Coins serão removidos\n` +
                    `• Você será banido permanentemente\n` +
                    `• Registrado em lista de fraudes\n\n` +
                    `💡 **Problemas? Abra um ticket ANTES de fazer estorno!**`
                )
                .setFooter({ text: 'Clique no botão abaixo APENAS se você concorda com os termos' })
                .setTimestamp();

            const termsRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`accept_terms_${packageId}`)
                        .setLabel('✅ Li e Aceito os Termos')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId('cancel_purchase')
                        .setLabel('❌ Cancelar')
                        .setStyle(ButtonStyle.Danger)
                );

            await interaction.editReply({ 
                embeds: [termsEmbed], 
                components: [termsRow] 
            });

            console.log(`[LOJA] Termos exibidos para ${interaction.user.tag}`);

        } catch (error) {
            console.error('[LOJA] Erro ao processar seleção:', error);

            // Enviar log de erro para Discord
            await sendErrorLog('Erro ao processar seleção de pacote', error, {
                userId: interaction.user.id,
                userTag: interaction.user.tag,
                action: 'package_selection',
                packageId: interaction.values?.[0]
            });

            await interaction.editReply({
                content: '❌ Erro ao processar sua seleção. Tente novamente.'
            });
        }
    }

    // ===== BOTÃO: ACEITAR TERMOS E MOSTRAR SELEÇÃO DE SERVIDOR =====
    if (interaction.isButton() && interaction.customId.startsWith('accept_terms_')) {
        try {
            const packageId = interaction.customId.replace('accept_terms_', '');
            console.log(`[LOJA] ${interaction.user.tag} aceitou os termos para ${packageId}`);

            // Carregar dados do pacote
            const coinPackages = require('./config/coin-packages.json');
            const selectedPackage = coinPackages.packages.find(pkg => pkg.id === packageId);
            const { formatCurrency } = require('./utils/mercadopago');

            // LOG DETALHADO: Termos aceitos
            const player = await db.collection('players').findOne({ discordId: interaction.user.id });
            const { sendDetailedLog } = require('./mercadopago-webhook');
            await sendDetailedLog('terms_accepted', {
                userId: interaction.user.id,
                userTag: interaction.user.tag,
                steamId: player?.steamId,
                packageId: selectedPackage.id,
                packageName: selectedPackage.name,
                amount: selectedPackage.price,
                player: player
            });

            const totalCoins = selectedPackage.coins + selectedPackage.bonus;
            const bonusText = selectedPackage.bonus > 0 ? ` + ${selectedPackage.bonus} bônus` : '';

            // Embed de seleção de servidor
            const serverSelectEmbed = new EmbedBuilder()
                .setColor('#FF6B00')
                .setTitle('🎮 Escolha o Servidor de Destino')
                .setDescription(
                    `**⚠️ ATENÇÃO: ESCOLHA COM CUIDADO!**\n\n` +
                    `Você está prestes a comprar:\n` +
                    `${selectedPackage.emoji} **${selectedPackage.name}** - ${formatCurrency(selectedPackage.price)}\n` +
                    `💰 **${totalCoins} coins** (${selectedPackage.coins}${bonusText})\n\n` +
                    `**Para qual servidor você deseja enviar os coins?**\n\n` +
                    `🔴 **IMPORTANTE:**\n` +
                    `• Os coins serão creditados **APENAS** no servidor escolhido\n` +
                    `• **NÃO é possível transferir** entre servidores\n` +
                    `• Escolha com atenção para evitar problemas\n` +
                    `• Em caso de erro, será necessário abrir ticket\n\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
                )
                .addFields(
                    {
                        name: '🔧 FullMod',
                        value: '**Servidor com diversos mods**\n' +
                               '• Carros e helicópteros\n' +
                               '• Traders ativos\n' +
                               '• Armas e roupas extras\n' +
                               '• Sistema de farm\n' +
                               '• Construção avançada',
                        inline: true
                    },
                    {
                        name: '🌿 Vanilla',
                        value: '**Servidor com mods básicos**\n' +
                               '• Apenas mods essenciais\n' +
                               '• Experiência mais limpa\n' +
                               '• Menos modificações\n' +
                               '• Foco em sobrevivência\n' +
                               '• Performance otimizada',
                        inline: true
                    }
                )
                .setFooter({ text: '⚠️ Confirme o servidor antes de continuar!' })
                .setTimestamp();

            const serverSelectRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`select_server_fullmod_${packageId}`)
                        .setLabel('🔧 FullMod')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('🔧'),
                    new ButtonBuilder()
                        .setCustomId(`select_server_vanilla_${packageId}`)
                        .setLabel('🌿 Vanilla')
                        .setStyle(ButtonStyle.Success)
                        .setEmoji('🌿')
                );

            const serverSelectRow2 = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`back_to_terms_${packageId}`)
                        .setLabel('◀️ Voltar aos Termos')
                        .setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId('cancel_purchase')
                        .setLabel('❌ Cancelar')
                        .setStyle(ButtonStyle.Danger)
                );

            await interaction.update({ 
                embeds: [serverSelectEmbed], 
                components: [serverSelectRow, serverSelectRow2] 
            });

            console.log(`[LOJA] Seleção de servidor exibida para ${interaction.user.tag}`);

        } catch (error) {
            console.error('[LOJA] Erro ao mostrar seleção de servidor:', error);
            await interaction.reply({ 
                content: '❌ Erro ao processar. Tente novamente.', 
                ephemeral: true 
            });
        }
    }

    // ===== BOTÃO: SELECIONAR SERVIDOR E MOSTRAR FORMAS DE PAGAMENTO =====
    if (interaction.isButton() && (interaction.customId.startsWith('select_server_fullmod_') || interaction.customId.startsWith('select_server_vanilla_'))) {
        try {
            const isFullmod = interaction.customId.startsWith('select_server_fullmod_');
            const serverType = isFullmod ? 'fullmod' : 'vanilla';
            const serverName = isFullmod ? 'FullMod' : 'Vanilla';
            const packageId = interaction.customId.replace(isFullmod ? 'select_server_fullmod_' : 'select_server_vanilla_', '');
            
            console.log(`[LOJA] ${interaction.user.tag} escolheu servidor ${serverName} para ${packageId}`);

            // Carregar dados do pacote
            const coinPackages = require('./config/coin-packages.json');
            const selectedPackage = coinPackages.packages.find(pkg => pkg.id === packageId);
            const { formatCurrency } = require('./utils/mercadopago');

            // LOG DETALHADO: Servidor selecionado
            const player = await db.collection('players').findOne({ discordId: interaction.user.id });
            const { sendDetailedLog } = require('./mercadopago-webhook');
            await sendDetailedLog('server_selected', {
                userId: interaction.user.id,
                userTag: interaction.user.tag,
                steamId: player?.steamId,
                packageId: selectedPackage.id,
                packageName: selectedPackage.name,
                amount: selectedPackage.price,
                serverType: serverType,
                serverName: serverName,
                player: player
            });

            const totalCoins = selectedPackage.coins + selectedPackage.bonus;
            const bonusText = selectedPackage.bonus > 0 ? ` + ${selectedPackage.bonus} bônus` : '';

            // Embed de formas de pagamento COM indicação do servidor
            const paymentMethodEmbed = new EmbedBuilder()
                .setColor('#00D9FF')
                .setTitle('💳 Escolha a Forma de Pagamento')
                .setDescription(
                    `**✅ Servidor Selecionado:** ${isFullmod ? '🔧' : '🌿'} **${serverName}**\n\n` +
                    `**Pacote:**\n` +
                    `${selectedPackage.emoji} ${selectedPackage.name} - ${formatCurrency(selectedPackage.price)}\n` +
                    `${totalCoins} coins (${selectedPackage.coins}${bonusText})\n\n` +
                    `**Escolha como deseja pagar:**`
                )
                .addFields(
                    {
                        name: '🔵 PIX (Recomendado)',
                        value: '✅ **Disponível**\n• Pagamento instantâneo\n• Disponível 24/7\n• Coins em segundos\n• QR Code ou Copia e Cola',
                        inline: true
                    },
                    {
                        name: '💳 Cartão de Crédito',
                        value: '✅ **Disponível**\n• Parcelamento disponível\n• Aprovação rápida\n• Todas as bandeiras\n• Processamento seguro',
                        inline: true
                    },
                    {
                        name: '🌎 PayPal',
                        value: '⏳ **Em breve**\n• Pagamentos internacionais\n• USD, EUR e outras moedas\n• Seguro e confiável\n• Aceito mundialmente',
                        inline: true
                    }
                )
                .setFooter({ text: `🎮 Coins serão enviados para: ${serverName} | Mercado Pago` })
                .setTimestamp();

            const paymentMethodRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`payment_pix_${packageId}_${serverType}`)
                        .setLabel('🔵 Pagar com PIX')
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId(`payment_credit_${packageId}_${serverType}`)
                        .setLabel('💳 Cartão de Crédito')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId(`payment_paypal_${packageId}_${serverType}`)
                        .setLabel('🌎 PayPal (Em breve)')
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(true)
                );

            const paymentMethodRow2 = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`back_to_server_select_${packageId}`)
                        .setLabel('◀️ Voltar à Seleção de Servidor')
                        .setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId('cancel_purchase')
                        .setLabel('❌ Cancelar')
                        .setStyle(ButtonStyle.Danger)
                );

            await interaction.update({ 
                embeds: [paymentMethodEmbed], 
                components: [paymentMethodRow, paymentMethodRow2] 
            });

            console.log(`[LOJA] Formas de pagamento exibidas para ${interaction.user.tag} (Servidor: ${serverName})`);

        } catch (error) {
            console.error('[LOJA] Erro ao mostrar formas de pagamento:', error);
            await interaction.reply({ 
                content: '❌ Erro ao processar. Tente novamente.', 
                ephemeral: true 
            });
        }
    }

    // ===== BOTÃO: PAGAMENTO PIX =====
    if (interaction.isButton() && interaction.customId.startsWith('payment_pix_')) {
        try {
            // Extrair packageId e serverType do customId
            // Formato: payment_pix_<packageId>_<serverType>
            // Exemplo: payment_pix_starter_pack_fullmod
            const withoutPrefix = interaction.customId.replace('payment_pix_', '');
            const customIdParts = withoutPrefix.split('_');
            const serverType = customIdParts[customIdParts.length - 1]; // Último elemento é o serverType
            const packageId = customIdParts.slice(0, -1).join('_'); // Tudo antes do serverType é o packageId
            const serverName = serverType === 'vanilla' ? 'Vanilla' : 'FullMod';
            
            console.log(`[LOJA] ${interaction.user.tag} escolheu PIX para ${packageId} no servidor ${serverName}`);

            await interaction.update({ 
                content: '⏳ Gerando pagamento PIX...', 
                embeds: [], 
                components: [] 
            });

            // Carregar dados do pacote
            const coinPackages = require('./config/coin-packages.json');
            const selectedPackage = coinPackages.packages.find(pkg => pkg.id === packageId);

            // Buscar dados do player
            const player = await db.collection('players').findOne({ discordId: interaction.user.id });

            if (!player) {
                return interaction.editReply({ 
                    content: '❌ Erro ao buscar seus dados. Tente novamente.' 
                });
            }

            // LOG DETALHADO: Método PIX escolhido
            const { sendDetailedLog } = require('./mercadopago-webhook');
            await sendDetailedLog('payment_method_selected', {
                userId: interaction.user.id,
                userTag: interaction.user.tag,
                steamId: player.steamId,
                packageId: selectedPackage.id,
                packageName: selectedPackage.name,
                amount: selectedPackage.price,
                method: 'PIX',
                serverType: serverType,
                serverName: serverName,
                player: player
            });

            // Criar pagamento PIX
            const { createPixPayment, formatCurrency } = require('./utils/mercadopago');
            const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');

            const paymentData = {
                amount: selectedPackage.price,
                description: `${selectedPackage.name} - DayZ Apocalypse`,
                email: player.email || `${player.discordId}@dayzapocalypse.com`,
                metadata: {
                    discordId: interaction.user.id,
                    discordTag: interaction.user.tag,
                    steamId: player.steamId,
                    playerName: player.steamName || player.name || interaction.user.username,
                    packageId: selectedPackage.id,
                    coins: selectedPackage.coins,
                    bonus: selectedPackage.bonus
                }
            };

            console.log(`[LOJA] Criando pagamento PIX para ${interaction.user.tag}...`);
            
            let payment;
            try {
                payment = await createPixPayment(paymentData);
            } catch (error) {
                console.error('[LOJA] Erro ao processar compra:', error);
                
                let errorMessage = '❌ **Erro ao criar pagamento!**\n\n';
                
                if (error.code === 'PA_UNAUTHORIZED_RESULT_FROM_POLICIES') {
                    errorMessage += 
                        '⚠️ **Sua conta do Mercado Pago está com restrições.**\n\n' +
                        '**Como resolver:**\n' +
                        '1. Acesse: https://www.mercadopago.com.br\n' +
                        '2. Complete o cadastro da sua conta\n' +
                        '3. Adicione uma chave PIX\n' +
                        '4. Verifique sua identidade\n\n' +
                        '**Para Admins:**\n' +
                        '• Verifique se está usando credenciais TEST\n' +
                        '• Confira se a chave PIX está configurada\n' +
                        '• Verifique políticas de segurança no painel MP';
                } else if (error.status === 401) {
                    errorMessage += 
                        '🔑 **Token de acesso inválido!**\n\n' +
                        '**Admin:** Verifique o `MERCADOPAGO_ACCESS_TOKEN` no arquivo .env';
                } else {
                    errorMessage += 
                        `**Erro:** ${error.message}\n\n` +
                        '💡 Entre em contato com um administrador.';
                }
                
                return interaction.editReply({ 
                    content: errorMessage,
                    embeds: [],
                    components: []
                });
            }

            // Salvar pagamento pendente no MongoDB (sem messageId ainda)
            await db.collection('payments').insertOne({
                paymentId: payment.id,
                userId: interaction.user.id,
                steamId: player.steamId,
                packageId: selectedPackage.id,
                packageName: selectedPackage.name,
                coins: selectedPackage.coins,
                bonus: selectedPackage.bonus,
                totalCoins: selectedPackage.coins + selectedPackage.bonus,
                amount: selectedPackage.price,
                status: 'pending',
                serverType: serverType, // fullmod ou vanilla
                serverName: serverName, // Nome amigável do servidor
                qr_code: payment.qr_code,
                qr_code_base64: payment.qr_code_base64,
                ticket_url: payment.ticket_url,
                expiresAt: new Date(payment.expiration_date),
                createdAt: new Date(),
                guildId: interaction.guild?.id,
                channelId: interaction.channel?.id,
                messageId: null // Será atualizado após enviar a mensagem
            });

            // Criar embed com informações do pagamento
            const totalCoins = selectedPackage.coins + selectedPackage.bonus;
            const bonusText = selectedPackage.bonus > 0 ? `\n+ **${selectedPackage.bonus} BÔNUS** 🎁` : '';
            const serverEmoji = serverType === 'vanilla' ? '🌿' : '🔧';

            const paymentEmbed = new EmbedBuilder()
                .setColor('#00FF00')
                .setTitle(`${selectedPackage.emoji} ${selectedPackage.name}`)
                .setDescription(
                    `**🎮 Servidor de Destino:** ${serverEmoji} **${serverName}**\n\n` +
                    `**💰 Valor:** ${formatCurrency(selectedPackage.price)}\n` +
                    `**🪙 Coins:** ${selectedPackage.coins}${bonusText}\n` +
                    `**📦 Total:** ${totalCoins} coins\n\n` +
                    `**⏰ Tempo para pagar:** 30 minutos\n` +
                    `**🔒 Status:** Aguardando pagamento...`
                )
                .addFields(
                    {
                        name: '📱 Como Pagar com PIX',
                        value: 
                            '**Opção 1 - QR Code:**\n' +
                            '1. Abra o app do seu banco\n' +
                            '2. Escolha "Pagar com PIX"\n' +
                            '3. Escaneie o QR Code abaixo\n\n' +
                            '**Opção 2 - Copia e Cola:**\n' +
                            '1. Clique no botão "📋 Copiar Código PIX"\n' +
                            '2. Cole no app do seu banco\n' +
                            '3. Confirme o pagamento',
                        inline: false
                    },
                    {
                        name: '✅ Após o Pagamento',
                        value: 
                            '• Você receberá uma confirmação aqui no Discord\n' +
                            '• Seus coins serão adicionados **automaticamente**\n' +
                            '• Processo leva apenas alguns segundos!',
                        inline: false
                    }
                )
                .setFooter({ text: `ID do Pagamento: ${payment.id} • Mercado Pago` })
                .setTimestamp();

            // Criar anexo com QR Code
            const qrBuffer = Buffer.from(payment.qr_code_base64, 'base64');
            const attachment = new AttachmentBuilder(qrBuffer, { name: 'qrcode.png' });
            
            paymentEmbed.setImage('attachment://qrcode.png');

            // Botões de ação
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`copy_pix_${payment.id}`)
                        .setLabel('📋 Copiar Código PIX')
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId(`check_payment_${payment.id}`)
                        .setLabel('✅ Verificar Pagamento')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setLabel('🌐 Abrir no Navegador')
                        .setStyle(ButtonStyle.Link)
                        .setURL(payment.ticket_url)
                );

            const row2 = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`back_to_payment_methods_${packageId}_${serverType}`)
                        .setLabel('◀️ Voltar')
                        .setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId(`cancel_payment_${payment.id}`)
                        .setLabel('❌ Cancelar Pagamento')
                        .setStyle(ButtonStyle.Danger)
                );

            await interaction.editReply({ 
                content: null,
                embeds: [paymentEmbed], 
                components: [row, row2],
                files: [attachment]
            });

            // Armazenar interação para editar depois quando pagamento for aprovado
            activePaymentInteractions.set(payment.id.toString(), {
                interaction: interaction,
                packageInfo: {
                    name: selectedPackage.name,
                    emoji: selectedPackage.emoji
                },
                userId: interaction.user.id,
                createdAt: Date.now()
            });

            console.log(`✅ [LOJA] Pagamento ${payment.id} criado para ${interaction.user.tag}`);
            console.log(`📌 [LOJA] Interação armazenada para futuras edições`);

            // LOG DETALHADO: Pagamento PIX criado
            await sendDetailedLog('payment_created', {
                userId: interaction.user.id,
                userTag: interaction.user.tag,
                steamId: player.steamId,
                packageId: selectedPackage.id,
                packageName: selectedPackage.name,
                amount: selectedPackage.price,
                coins: selectedPackage.coins + selectedPackage.bonus,
                paymentId: payment.id,
                method: 'PIX',
                serverType: serverType,
                serverName: serverName,
                player: player
            });

        } catch (error) {
            console.error('[LOJA] Erro ao processar compra:', error);

            // Enviar log de erro para Discord
            await sendErrorLog('Erro ao processar pagamento PIX', error, {
                userId: interaction.user.id,
                userTag: interaction.user.tag,
                action: 'payment_pix',
                packageId: interaction.customId.replace('payment_pix_', '').split('_').slice(0, -1).join('_'),
                serverType: interaction.customId.replace('payment_pix_', '').split('_').pop()
            });

            await interaction.followUp({
                content: '❌ Erro ao processar sua compra. Tente novamente ou contate um administrador.\n' +
                         `Detalhes: \`${error.message}\``,
                ephemeral: true
            });
        }
    }

    // ===== BOTÃO: PAGAMENTO CARTÃO DE CRÉDITO =====
    if (interaction.isButton() && interaction.customId.startsWith('payment_credit_')) {
        try {
            // Extrair packageId e serverType do customId
            // Formato: payment_credit_<packageId>_<serverType>
            // Exemplo: payment_credit_starter_pack_fullmod
            const withoutPrefix = interaction.customId.replace('payment_credit_', '');
            const customIdParts = withoutPrefix.split('_');
            const serverType = customIdParts[customIdParts.length - 1]; // Último elemento é o serverType
            const packageId = customIdParts.slice(0, -1).join('_'); // Tudo antes do serverType é o packageId
            const serverName = serverType === 'vanilla' ? 'Vanilla' : 'FullMod';
            
            console.log(`[LOJA] ${interaction.user.tag} escolheu Cartão para ${packageId} no servidor ${serverName}`);

            await interaction.update({ 
                content: '⏳ Gerando link de pagamento...', 
                embeds: [], 
                components: [] 
            });

            // Carregar dados do pacote
            const coinPackages = require('./config/coin-packages.json');
            const selectedPackage = coinPackages.packages.find(pkg => pkg.id === packageId);

            // Buscar dados do player
            const player = await db.collection('players').findOne({ discordId: interaction.user.id });

            if (!player) {
                return interaction.editReply({ 
                    content: '❌ Erro ao buscar seus dados. Tente novamente.' 
                });
            }

            // Criar preferência de pagamento (Checkout Pro)
            const { createCreditCardPayment, formatCurrency } = require('./utils/mercadopago');

            const paymentData = {
                amount: selectedPackage.price,
                description: `${selectedPackage.name} - DayZ Apocalypse`,
                email: player.email || `${player.discordId}@dayzapocalypse.com`,
                metadata: {
                    discordId: interaction.user.id,
                    discordTag: interaction.user.tag,
                    steamId: player.steamId,
                    playerName: player.steamName || player.name || interaction.user.username,
                    packageId: selectedPackage.id,
                    coins: selectedPackage.coins,
                    bonus: selectedPackage.bonus
                }
            };

            let payment;
            try {
                payment = await createCreditCardPayment(paymentData);
            } catch (error) {
                console.error('[LOJA] Erro ao criar checkout:', error);
                return interaction.editReply({ 
                    content: '❌ **Erro ao criar link de pagamento!**\n\nTente novamente ou use PIX.',
                    embeds: [],
                    components: []
                });
            }

            // Salvar pagamento pendente no MongoDB
            await db.collection('payments').insertOne({
                paymentId: payment.id,
                userId: interaction.user.id,
                steamId: player.steamId,
                packageId: selectedPackage.id,
                packageName: selectedPackage.name,
                coins: selectedPackage.coins,
                bonus: selectedPackage.bonus,
                totalCoins: selectedPackage.coins + selectedPackage.bonus,
                amount: selectedPackage.price,
                status: 'pending',
                paymentType: 'credit_card',
                serverType: serverType, // fullmod ou vanilla
                serverName: serverName, // Nome amigável do servidor
                checkoutUrl: payment.init_point,
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 horas
                createdAt: new Date()
            });

            const totalCoins = selectedPackage.coins + selectedPackage.bonus;
            const bonusText = selectedPackage.bonus > 0 ? `\n+ **${selectedPackage.bonus} BÔNUS** 🎁` : '';
            const serverEmoji = serverType === 'vanilla' ? '🌿' : '🔧';

            const creditEmbed = new EmbedBuilder()
                .setColor('#00D9FF')
                .setTitle(`💳 ${selectedPackage.name}`)
                .setDescription(
                    `**🎮 Servidor de Destino:** ${serverEmoji} **${serverName}**\n\n` +
                    `**💰 Valor:** ${formatCurrency(selectedPackage.price)}\n` +
                    `**🪙 Coins:** ${selectedPackage.coins}${bonusText}\n` +
                    `**📦 Total:** ${totalCoins} coins\n\n` +
                    `**⏰ Link válido por:** 24 horas\n` +
                    `**🔒 Status:** Aguardando pagamento...`
                )
                .addFields(
                    {
                        name: '💳 Como Pagar com Cartão',
                        value: 
                            '1. Clique no botão "🌐 Ir para Checkout"\n' +
                            '2. Você será redirecionado ao site seguro do Mercado Pago\n' +
                            '3. Preencha os dados do seu cartão\n' +
                            '4. Escolha o parcelamento desejado (até 12x)\n' +
                            '5. Confirme o pagamento com segurança',
                        inline: false
                    },
                    {
                        name: '🔐 Segurança Garantida',
                        value:
                            '✅ Seus dados são processados diretamente pelo Mercado Pago\n' +
                            '✅ Não armazenamos informações do seu cartão\n' +
                            '✅ Transação protegida com certificado SSL\n' +
                            '✅ Plataforma certificada PCI DSS',
                        inline: false
                    },
                    {
                        name: '✅ Após o Pagamento',
                        value: 
                            '• Você receberá uma confirmação aqui no Discord\n' +
                            '• Seus coins serão adicionados **automaticamente**\n' +
                            '• Processo leva apenas alguns segundos!\n' +
                            '• Pode parcelar em até 12x sem juros',
                        inline: false
                    }
                )
                .setFooter({ text: `ID: ${payment.id} • Mercado Pago Checkout` })
                .setTimestamp();

            const creditRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setLabel('🌐 Ir para Checkout')
                        .setStyle(ButtonStyle.Link)
                        .setURL(payment.init_point),
                    new ButtonBuilder()
                        .setCustomId(`back_to_payment_methods_${packageId}_${serverType}`)
                        .setLabel('◀️ Voltar')
                        .setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId(`cancel_payment_${payment.id}`)
                        .setLabel('❌ Cancelar')
                        .setStyle(ButtonStyle.Danger)
                );

            await interaction.editReply({ 
                content: null,
                embeds: [creditEmbed], 
                components: [creditRow]
            });

            console.log(`✅ [LOJA] Checkout ${payment.id} criado para ${interaction.user.tag}`);

        } catch (error) {
            console.error('[LOJA] Erro ao processar cartão:', error);

            // Enviar log de erro para Discord
            await sendErrorLog('Erro ao processar pagamento com Cartão', error, {
                userId: interaction.user.id,
                userTag: interaction.user.tag,
                action: 'payment_credit',
                packageId: interaction.customId.replace('payment_credit_', '').split('_').slice(0, -1).join('_'),
                serverType: interaction.customId.replace('payment_credit_', '').split('_').pop()
            });

            await interaction.editReply({
                content: '❌ Erro ao processar. Tente novamente.',
                embeds: [],
                components: []
            });
        }
    }

    // ===== BOTÃO: CANCELAR PAGAMENTO PIX/CREDIT =====
    if (interaction.isButton() && interaction.customId.startsWith('cancel_payment_')) {
        try {
            const paymentId = interaction.customId.replace('cancel_payment_', '');
            
            // Buscar dados do pagamento para log
            const payment = await db.collection('payments').findOne({ paymentId: parseInt(paymentId) });
            
            if (!payment) {
                // Pagamento não existe no banco (cancelado antes de criar)
                await interaction.update({
                    content: '❌ **Operação cancelada.**\n\nVocê pode voltar ao painel da loja a qualquer momento.',
                    embeds: [],
                    components: [],
                    files: [] // Limpar QR Code se houver
                });
                console.log(`[LOJA] ${interaction.user.tag} cancelou antes de criar pagamento ${paymentId}`);
                
                // LOG DETALHADO: Cancelamento antes de criar pagamento (ex: cartão de crédito)
                const player = await db.collection('players').findOne({ discordId: interaction.user.id });
                const { sendDetailedLog } = require('./mercadopago-webhook');
                
                // Detectar método pelo embed
                let method = 'Desconhecido';
                if (interaction.message.embeds && interaction.message.embeds.length > 0) {
                    const embedTitle = interaction.message.embeds[0].title || '';
                    if (embedTitle.includes('💳')) {
                        method = 'Cartão de Crédito';
                    } else if (embedTitle.includes('🔵') || embedTitle.toLowerCase().includes('pix')) {
                        method = 'PIX';
                    }
                }
                
                await sendDetailedLog('payment_cancelled', {
                    userId: interaction.user.id,
                    userTag: interaction.user.tag,
                    steamId: player?.steamId,
                    paymentId: paymentId,
                    packageName: 'N/A (não criado)',
                    amount: 0,
                    cancelStep: `Etapa de Pagamento (${method})`,
                    paymentMethod: method,
                    player: player
                });
                
                return;
            }

            // Determinar em qual etapa estava
            const paymentMethod = payment.paymentType === 'credit_card' ? 'Cartão de Crédito' : 'PIX';
            const cancelStep = payment.status === 'pending' ? `Etapa de Pagamento (${paymentMethod})` : 'Pagamento';
            
            // Marcar pagamento como cancelado no banco
            await db.collection('payments').updateOne(
                { paymentId: parseInt(paymentId) },
                { 
                    $set: { 
                        status: 'cancelled',
                        cancelledAt: new Date(),
                        cancelledBy: interaction.user.id,
                        cancelStep: cancelStep
                    } 
                }
            );
            
            await interaction.update({
                content: `❌ **Pagamento cancelado com sucesso!**\n\n**Etapa:** ${cancelStep}\n\nVocê pode fazer uma nova compra a qualquer momento no painel da loja.`,
                embeds: [],
                components: [],
                files: [] // Limpar QR Code se houver
            });
            
            console.log(`[LOJA] ${interaction.user.tag} cancelou pagamento #${paymentId} na etapa: ${cancelStep}`);

            // LOG DETALHADO: Pagamento cancelado
            const player = await db.collection('players').findOne({ steamId: payment.steamId });
            const { sendDetailedLog } = require('./mercadopago-webhook');
            await sendDetailedLog('payment_cancelled', {
                userId: interaction.user.id,
                userTag: interaction.user.tag,
                steamId: payment.steamId,
                paymentId: paymentId,
                packageName: payment.packageName,
                amount: payment.amount,
                cancelStep: cancelStep,
                paymentMethod: paymentMethod,
                serverType: payment.serverType,
                serverName: payment.serverName,
                player: player
            });

        } catch (error) {
            console.error('[LOJA] Erro ao cancelar pagamento:', error);
            await interaction.reply({ 
                content: '❌ Erro ao cancelar pagamento.', 
                ephemeral: true 
            });
        }
    }

    // ===== BOTÃO: VOLTAR PARA SELEÇÃO DE SERVIDOR =====
    if (interaction.isButton() && interaction.customId.startsWith('back_to_server_select_')) {
        try {
            const packageId = interaction.customId.replace('back_to_server_select_', '');
            console.log(`[LOJA] ${interaction.user.tag} voltou para seleção de servidor do pacote ${packageId}`);

            // Log silencioso no MongoDB
            await db.collection('user_navigation').insertOne({
                userId: interaction.user.id,
                userTag: interaction.user.tag,
                action: 'back_button',
                from: 'payment_methods',
                to: 'server_selection',
                packageId: packageId,
                timestamp: new Date()
            });

            // Recarregar dados do pacote
            const coinPackages = require('./config/coin-packages.json');
            const selectedPackage = coinPackages.packages.find(pkg => pkg.id === packageId);
            const { formatCurrency } = require('./utils/mercadopago');

            const totalCoins = selectedPackage.coins + selectedPackage.bonus;
            const bonusText = selectedPackage.bonus > 0 ? ` + ${selectedPackage.bonus} bônus` : '';

            // Recriar embed de seleção de servidor
            const serverSelectEmbed = new EmbedBuilder()
                .setColor('#FF6B00')
                .setTitle('🎮 Escolha o Servidor de Destino')
                .setDescription(
                    `**⚠️ ATENÇÃO: ESCOLHA COM CUIDADO!**\n\n` +
                    `Você está prestes a comprar:\n` +
                    `${selectedPackage.emoji} **${selectedPackage.name}** - ${formatCurrency(selectedPackage.price)}\n` +
                    `💰 **${totalCoins} coins** (${selectedPackage.coins}${bonusText})\n\n` +
                    `**Para qual servidor você deseja enviar os coins?**\n\n` +
                    `🔴 **IMPORTANTE:**\n` +
                    `• Os coins serão creditados **APENAS** no servidor escolhido\n` +
                    `• **NÃO é possível transferir** entre servidores\n` +
                    `• Escolha com atenção para evitar problemas\n` +
                    `• Em caso de erro, será necessário abrir ticket\n\n` +
                    `─────────────────────────────────────`
                )
                .addFields(
                    {
                        name: '🔧 FullMod',
                        value: '**Servidor com diversos mods**\n' +
                               '• Carros e helicópteros\n' +
                               '• Traders ativos\n' +
                               '• Armas e roupas extras\n' +
                               '• Sistema de farm\n' +
                               '• Construção avançada',
                        inline: true
                    },
                    {
                        name: '🌿 Vanilla',
                        value: '**Servidor com mods básicos**\n' +
                               '• Apenas mods essenciais\n' +
                               '• Experiência mais limpa\n' +
                               '• Menos modificações\n' +
                               '• Foco em sobrevivência\n' +
                               '• Performance otimizada',
                        inline: true
                    }
                )
                .setFooter({ text: '⚠️ Confirme o servidor antes de continuar!' })
                .setTimestamp();

            const serverSelectRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`select_server_fullmod_${packageId}`)
                        .setLabel('🔧 FullMod')
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId(`select_server_vanilla_${packageId}`)
                        .setLabel('🌿 Vanilla')
                        .setStyle(ButtonStyle.Success)
                );

            const serverSelectRow2 = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`back_to_terms_${packageId}`)
                        .setLabel('◀️ Voltar aos Termos')
                        .setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId('cancel_purchase')
                        .setLabel('❌ Cancelar')
                        .setStyle(ButtonStyle.Danger)
                );

            await interaction.update({ 
                content: null,
                embeds: [serverSelectEmbed], 
                components: [serverSelectRow, serverSelectRow2],
                files: [] // Limpar QR Code se houver
            });

            console.log(`[LOJA] ${interaction.user.tag} voltou para tela de seleção de servidor`);

        } catch (error) {
            console.error('[LOJA] Erro ao voltar para seleção de servidor:', error);
            await interaction.reply({ 
                content: '❌ Erro ao voltar. Tente novamente.', 
                ephemeral: true 
            });
        }
    }

    // ===== BOTÃO: VOLTAR PARA FORMAS DE PAGAMENTO =====
    if (interaction.isButton() && interaction.customId.startsWith('back_to_payment_methods_')) {
        try {
            // Extrair packageId e serverType
            // Formato: back_to_payment_methods_<packageId>_<serverType>
            const withoutPrefix = interaction.customId.replace('back_to_payment_methods_', '');
            const customIdParts = withoutPrefix.split('_');
            const serverType = customIdParts[customIdParts.length - 1]; // Último elemento é o serverType
            const packageId = customIdParts.slice(0, -1).join('_'); // Tudo antes do serverType é o packageId
            const serverName = serverType === 'vanilla' ? 'Vanilla' : 'FullMod';
            
            console.log(`[LOJA] ${interaction.user.tag} voltou para formas de pagamento do pacote ${packageId} (${serverName})`);

            // Log silencioso no MongoDB
            await db.collection('user_navigation').insertOne({
                userId: interaction.user.id,
                userTag: interaction.user.tag,
                action: 'back_button',
                from: 'payment_screen',
                to: 'payment_methods',
                packageId: packageId,
                serverType: serverType,
                serverName: serverName,
                timestamp: new Date()
            });

            // Recarregar dados do pacote
            const coinPackages = require('./config/coin-packages.json');
            const selectedPackage = coinPackages.packages.find(pkg => pkg.id === packageId);
            const { formatCurrency } = require('./utils/mercadopago');

            const totalCoins = selectedPackage.coins + selectedPackage.bonus;
            const bonusText = selectedPackage.bonus > 0 ? ` + ${selectedPackage.bonus} bônus` : '';

            // Recriar embed de formas de pagamento COM servidor
            const paymentMethodEmbed = new EmbedBuilder()
                .setColor('#00D9FF')
                .setTitle('💳 Escolha a Forma de Pagamento')
                .setDescription(
                    `**✅ Servidor Selecionado:** ${serverType === 'vanilla' ? '🌿' : '🔧'} **${serverName}**\n\n` +
                    `**Pacote:**\n` +
                    `${selectedPackage.emoji} ${selectedPackage.name} - ${formatCurrency(selectedPackage.price)}\n` +
                    `${totalCoins} coins (${selectedPackage.coins}${bonusText})\n\n` +
                    `**Escolha como deseja pagar:**`
                )
                .addFields(
                    {
                        name: '🔵 PIX (Recomendado)',
                        value: '✅ **Disponível**\n• Pagamento instantâneo\n• Disponível 24/7\n• Coins em segundos\n• QR Code ou Copia e Cola',
                        inline: true
                    },
                    {
                        name: '💳 Cartão de Crédito',
                        value: '✅ **Disponível**\n• Parcelamento disponível\n• Aprovação rápida\n• Todas as bandeiras\n• Processamento seguro',
                        inline: true
                    },
                    {
                        name: '🌎 PayPal',
                        value: '⏳ **Em breve**\n• Pagamentos internacionais\n• USD, EUR e outras moedas\n• Seguro e confiável\n• Aceito mundialmente',
                        inline: true
                    }
                )
                .setFooter({ text: 'Mercado Pago - Pagamento Seguro' })
                .setTimestamp();

            const paymentMethodRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`payment_pix_${packageId}_${serverType}`)
                        .setLabel('🔵 Pagar com PIX')
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId(`payment_credit_${packageId}_${serverType}`)
                        .setLabel('💳 Cartão de Crédito')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId(`payment_paypal_${packageId}_${serverType}`)
                        .setLabel('🌎 PayPal (Em breve)')
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(true)
                );

            const paymentMethodRow2 = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`back_to_server_select_${packageId}`)
                        .setLabel('◀️ Voltar à Seleção de Servidor')
                        .setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId('cancel_purchase')
                        .setLabel('❌ Cancelar')
                        .setStyle(ButtonStyle.Danger)
                );

            await interaction.update({ 
                content: null,
                embeds: [paymentMethodEmbed], 
                components: [paymentMethodRow, paymentMethodRow2],
                files: [] // Limpar QR Code do PIX
            });

            console.log(`[LOJA] ${interaction.user.tag} voltou para tela de formas de pagamento (${serverName})`);

        } catch (error) {
            console.error('[LOJA] Erro ao voltar para formas de pagamento:', error);
            await interaction.reply({ 
                content: '❌ Erro ao voltar. Tente novamente.', 
                ephemeral: true 
            });
        }
    }

    // ===== BOTÃO: VOLTAR PARA TERMOS =====
    if (interaction.isButton() && interaction.customId.startsWith('back_to_terms_')) {
        try {
            const packageId = interaction.customId.replace('back_to_terms_', '');
            console.log(`[LOJA] ${interaction.user.tag} voltou para os termos do pacote ${packageId}`);

            // Log silencioso no MongoDB
            await db.collection('user_navigation').insertOne({
                userId: interaction.user.id,
                userTag: interaction.user.tag,
                action: 'back_button',
                from: 'server_selection',
                to: 'terms',
                packageId: packageId,
                timestamp: new Date()
            });

            // Recarregar dados do pacote
            const coinPackages = require('./config/coin-packages.json');
            const selectedPackage = coinPackages.packages.find(pkg => pkg.id === packageId);
            const { formatCurrency } = require('./utils/mercadopago');
            const player = await db.collection('players').findOne({ discordId: interaction.user.id });
            
            // Buscar saldo REAL do arquivo JSON do mod
            const { getCoins } = require('./utils/coins');
            const currentCoins = getCoins(player.steamId);

            const totalCoins = selectedPackage.coins + selectedPackage.bonus;
            const bonusText = selectedPackage.bonus > 0 ? ` + ${selectedPackage.bonus} bônus` : '';

            // Recriar embed de termos
            const termsEmbed = new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('⚠️ LEIA ANTES DE COMPRAR')
                .setDescription(
                    `**💰 Seu saldo atual: ${currentCoins} coins**\n\n` +
                    `**Você está prestes a comprar:**\n` +
                    `${selectedPackage.emoji} ${selectedPackage.name} - ${formatCurrency(selectedPackage.price)}\n` +
                    `${totalCoins} coins (${selectedPackage.coins}${bonusText})\n` +
                    `**Novo saldo:** ${currentCoins + totalCoins} coins\n\n` +
                    `**📜 POLÍTICA DE REEMBOLSO:**\n\n` +
                    `❌ **NÃO REALIZAMOS REEMBOLSOS** em casos normais\n\n` +
                    `✅ **Reembolso apenas se:**\n` +
                    `• Erro técnico comprovado\n` +
                    `• Você NÃO gastou nenhum coin\n` +
                    `• Duplicação de pagamento\n\n` +
                    `⚠️ **NÃO damos reembolso se:**\n` +
                    `• Você gastou os coins (mesmo 1 coin)\n` +
                    `• Mudou de ideia\n` +
                    `• Foi banido do servidor\n` +
                    `• Perdeu itens no jogo\n\n` +
                    `🚨 **ESTORNO BANCÁRIO:**\n` +
                    `Se você fizer estorno pelo banco:\n` +
                    `• Coins serão removidos\n` +
                    `• Você será banido permanentemente\n` +
                    `• Registrado em lista de fraudes\n\n` +
                    `💡 **Problemas? Abra um ticket ANTES de fazer estorno!**`
                )
                .setFooter({ text: 'Clique no botão abaixo APENAS se você concorda com os termos' })
                .setTimestamp();

            const termsRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`accept_terms_${packageId}`)
                        .setLabel('✅ Li e Aceito os Termos')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId('cancel_purchase')
                        .setLabel('❌ Cancelar')
                        .setStyle(ButtonStyle.Danger)
                );

            await interaction.update({ 
                content: null,
                embeds: [termsEmbed], 
                components: [termsRow],
                files: [] // Limpar QR Code do PIX
            });

            console.log(`[LOJA] ${interaction.user.tag} voltou para tela de termos`);

        } catch (error) {
            console.error('[LOJA] Erro ao voltar para termos:', error);
            await interaction.reply({ 
                content: '❌ Erro ao voltar. Tente novamente.', 
                ephemeral: true 
            });
        }
    }

    // ===== BOTÃO: CANCELAR COMPRA =====
    if (interaction.isButton() && interaction.customId === 'cancel_purchase') {
        try {
            // Buscar dados do player para log
            const player = await db.collection('players').findOne({ discordId: interaction.user.id });
            
            // Detectar em qual etapa o usuário está pelo conteúdo do embed
            let cancelStep = 'Desconhecido';
            if (interaction.message.embeds && interaction.message.embeds.length > 0) {
                const embedTitle = interaction.message.embeds[0].title || '';
                if (embedTitle.includes('LEIA ANTES DE COMPRAR')) {
                    cancelStep = 'Termos de Serviço';
                } else if (embedTitle.includes('Escolha a Forma de Pagamento')) {
                    cancelStep = 'Forma de Pagamento';
                }
            }
            
            await interaction.update({
                content: `❌ **Compra cancelada.**\n\nVocê pode voltar ao painel da loja a qualquer momento.`,
                embeds: [],
                components: [],
                files: [] // Limpar anexos se houver
            });
            
            console.log(`[LOJA] ${interaction.user.tag} cancelou a compra na etapa: ${cancelStep}`);

            // LOG DETALHADO: Cancelamento
            const { sendDetailedLog } = require('./mercadopago-webhook');
            await sendDetailedLog('purchase_cancelled', {
                userId: interaction.user.id,
                userTag: interaction.user.tag,
                steamId: player?.steamId,
                cancelStep: cancelStep,
                player: player
            });
        } catch (error) {
            console.error('[LOJA] Erro ao processar cancelamento:', error);
            await interaction.update({
                content: '❌ Compra cancelada.',
                embeds: [],
                components: [],
                files: []
            });
        }
    }

    // ===== BOTÃO: COPIAR CÓDIGO PIX =====
    if (interaction.isButton() && interaction.customId.startsWith('copy_pix_')) {
        try {
            const paymentId = interaction.customId.replace('copy_pix_', '');
            
            const payment = await db.collection('payments').findOne({ 
                paymentId: parseInt(paymentId) 
            });

            if (!payment) {
                return interaction.reply({ 
                    content: '❌ Pagamento não encontrado!', 
                    ephemeral: true 
                });
            }

            if (payment.userId !== interaction.user.id) {
                return interaction.reply({ 
                    content: '❌ Este pagamento não pertence a você!', 
                    ephemeral: true 
                });
            }

            // Enviar código PIX em mensagem efêmera
            await interaction.reply({
                content: 
                    '**📋 Código PIX Copia e Cola:**\n\n' +
                    `\`\`\`${payment.qr_code}\`\`\`\n\n` +
                    '**Como usar:**\n' +
                    '1. Copie o código acima\n' +
                    '2. Abra o app do seu banco\n' +
                    '3. Escolha "PIX Copia e Cola"\n' +
                    '4. Cole o código e confirme!',
                ephemeral: true
            });

            console.log(`[PIX] ${interaction.user.tag} copiou código do pagamento ${paymentId}`);

        } catch (error) {
            console.error('[PIX] Erro ao copiar código:', error);
            await interaction.reply({ 
                content: '❌ Erro ao buscar código PIX.', 
                ephemeral: true 
            });
        }
    }

    // ===== BOTÃO: VERIFICAR PAGAMENTO MANUALMENTE =====
    if (interaction.isButton() && interaction.customId.startsWith('check_payment_')) {
        try {
            const paymentId = interaction.customId.replace('check_payment_', '');
            
            await interaction.deferReply({ ephemeral: true });
            
            console.log(`[LOJA] ${interaction.user.tag} solicitou verificação manual do pagamento ${paymentId}`);

            // Buscar pagamento no banco
            const paymentRecord = await db.collection('payments').findOne({ 
                paymentId: parseInt(paymentId) 
            });

            // LOG DETALHADO: Verificação manual solicitada (antes de consultar MP)
            if (paymentRecord) {
                const player = await db.collection('players').findOne({ steamId: paymentRecord.steamId });
                const { sendDetailedLog } = require('./mercadopago-webhook');
                await sendDetailedLog('manual_verification', {
                    userId: interaction.user.id,
                    userTag: interaction.user.tag,
                    steamId: paymentRecord.steamId,
                    paymentId: paymentId,
                    status: 'Consultando...',
                    player: player
                });
            }

            if (!paymentRecord) {
                return interaction.editReply({ 
                    content: '❌ Pagamento não encontrado!' 
                });
            }

            if (paymentRecord.userId !== interaction.user.id) {
                return interaction.editReply({ 
                    content: '❌ Este pagamento não pertence a você!' 
                });
            }

            // Verificar se já foi processado
            if (paymentRecord.status === 'approved' || paymentRecord.status === 'completed') {
                return interaction.editReply({ 
                    content: '✅ **Este pagamento já foi aprovado e processado!**\n\nSeus coins já foram creditados.' 
                });
            }

            // Consultar status na API do Mercado Pago
            const { MercadoPagoConfig, Payment } = require('mercadopago');
            const client = new MercadoPagoConfig({ 
                accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN 
            });
            const paymentAPI = new Payment(client);

            await interaction.editReply({ 
                content: '⏳ Consultando status do pagamento no Mercado Pago...' 
            });

            let mpPayment;
            try {
                mpPayment = await paymentAPI.get({ id: paymentId });
            } catch (error) {
                console.error('[LOJA] Erro ao consultar pagamento:', error);
                return interaction.editReply({ 
                    content: 
                        '❌ **Erro ao consultar pagamento!**\n\n' +
                        '**Possíveis causas:**\n' +
                        '• Pagamento ainda não foi realizado\n' +
                        '• Mercado Pago ainda está processando\n' +
                        '• Erro temporário na API\n\n' +
                        '💡 **Aguarde alguns instantes e tente novamente.**'
                });
            }

            console.log(`[LOJA] Status do pagamento ${paymentId}: ${mpPayment.status}`);

            // Verificar status
            if (mpPayment.status === 'approved') {
                await interaction.editReply({ 
                    content: '✅ **Pagamento confirmado!** Processando coins...' 
                });

                // Processar o pagamento (adicionar coins)
                const player = await db.collection('players').findOne({ 
                    discordId: interaction.user.id 
                });

                if (!player) {
                    return interaction.editReply({ 
                        content: '❌ Erro ao buscar dados do player!' 
                    });
                }

                const totalCoins = paymentRecord.coins + paymentRecord.bonus;

                // Determinar diretório baseado no servidor escolhido
                let playerDataDir;
                if (paymentRecord.serverType === 'vanilla') {
                    playerDataDir = process.env.COINS_DATA_DIR_VANILLA || 'C:\\DayZServer1.28_TESTE\\DayZServerVanilla_TESTE\\Profiles\\ModsSparda\\Store\\PlayerAccounts';
                } else {
                    // fullmod (padrão)
                    playerDataDir = process.env.COINS_DATA_DIR || 'C:\\DayZServer1.28_TESTE\\DayZServerModded_TESTE\\Profiles\\ModsSparda\\Store\\PlayerAccounts';
                }
                
                const serverDisplayName = paymentRecord.serverName || (paymentRecord.serverType === 'vanilla' ? 'Vanilla' : 'FullMod');
                
                if (!playerDataDir) {
                    console.error('❌ [CRÍTICO] COINS_DATA_DIR não configurado no .env!');
                    return interaction.editReply({ 
                        content: '❌ Erro de configuração do servidor. Contate um administrador.'
                    });
                }
                
                const playerDataPath = path.join(playerDataDir, `${player.steamId}.json`);

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
                        steamid: player.steamId,
                        coins: 0
                    };
                }

                const saldoAnterior = parseInt(playerData.coins) || 0;
                playerData.coins = saldoAnterior + totalCoins;

                // Garantir que steamid está no formato correto
                playerData.steamid = player.steamId;

                // Salvar arquivo atualizado (formato exato do mod)
                fs.writeFileSync(playerDataPath, JSON.stringify(playerData, null, 4), 'utf8');
                console.log(`✅ [LOJA] ${totalCoins} coins adicionados para ${player.steamId} no servidor ${serverDisplayName} (${saldoAnterior} → ${playerData.coins})`);

                // Atualizar coins no MongoDB também
                await db.collection('players').updateOne(
                    { steamId: player.steamId },
                    { 
                        $set: { 
                            coins: playerData.coins,
                            updatedAt: new Date()
                        }
                    }
                );

                // Atualizar status do pagamento
                await db.collection('payments').updateOne(
                    { paymentId: parseInt(paymentId) },
                    { 
                        $set: { 
                            status: 'approved',
                            processedAt: new Date(),
                            manuallyVerified: true
                        } 
                    }
                );

                // Calcular novo saldo
                const newBalance = playerData.coins;

                // Enviar confirmação ao usuário
                const successEmbed = new EmbedBuilder()
                    .setColor('#00FF00')
                    .setTitle('✅ Pagamento Aprovado!')
                    .setDescription(
                        `**Obrigado pela sua compra!**\n\n` +
                        `💰 **+${totalCoins} coins** foram adicionados à sua conta!\n\n` +
                        `**Detalhes:**\n` +
                        `• Pacote: ${paymentRecord.packageName}\n` +
                        `• Coins: ${paymentRecord.coins}\n` +
                        `• Bônus: ${paymentRecord.bonus}\n` +
                        `• Total: ${totalCoins} coins\n` +
                        `• **Saldo atual: ${newBalance} coins**\n\n` +
                        `🎮 **Entre no servidor e pressione "i" para usar seus coins!**`
                    )
                    .setFooter({ text: `ID do Pagamento: ${paymentId}` })
                    .setTimestamp();

                await interaction.editReply({ 
                    content: null,
                    embeds: [successEmbed]
                });

            // Enviar DM ao player
            try {
                await interaction.user.send({ embeds: [successEmbed] });
                console.log(`[LOJA] DM enviado para ${interaction.user.tag}`);
            } catch (dmError) {
                console.log(`[LOJA] Não foi possível enviar DM para ${interaction.user.tag}`);
            }

            console.log(`✅ [LOJA] Pagamento ${paymentId} aprovado manualmente! ${totalCoins} coins adicionados para ${interaction.user.tag}`);

                // Log de transação
                await db.collection('logs').insertOne({
                    type: 'coin_purchase_manual',
                    userId: interaction.user.id,
                    steamId: player.steamId,
                    paymentId: paymentId,
                    amount: paymentRecord.amount,
                    coins: paymentRecord.coins,
                    bonus: paymentRecord.bonus,
                    totalCoins: totalCoins,
                    saldoAnterior: saldoAnterior,
                    novoSaldo: playerData.coins,
                    packageId: paymentRecord.packageId,
                    timestamp: new Date()
                });

            } else if (mpPayment.status === 'pending') {
                await interaction.editReply({ 
                    content: 
                        '⏳ **Pagamento ainda está pendente**\n\n' +
                        '**Status:** Aguardando confirmação do pagamento\n\n' +
                        '💡 **O que fazer:**\n' +
                        '• Se você já pagou, aguarde alguns minutos\n' +
                        '• O sistema detectará automaticamente quando for aprovado\n' +
                        '• Você pode clicar em "✅ Verificar Pagamento" novamente em alguns instantes'
                });
            } else if (mpPayment.status === 'rejected') {
                await interaction.editReply({ 
                    content: 
                        '❌ **Pagamento foi rejeitado**\n\n' +
                        `**Motivo:** ${mpPayment.status_detail}\n\n` +
                        '💡 **O que fazer:**\n' +
                        '• Tente fazer um novo pagamento\n' +
                        '• Verifique se você tem saldo suficiente\n' +
                        '• Entre em contato com seu banco se necessário'
                });

                // Atualizar status no banco
                await db.collection('payments').updateOne(
                    { paymentId: parseInt(paymentId) },
                    { $set: { status: 'rejected', rejectedAt: new Date() } }
                );
            } else {
                await interaction.editReply({ 
                    content: 
                        `⚠️ **Status do pagamento:** ${mpPayment.status}\n\n` +
                        '💡 Entre em contato com um administrador se o problema persistir.'
                });
            }

        } catch (error) {
            console.error('[LOJA] Erro ao verificar pagamento:', error);
            await interaction.editReply({ 
                content: 
                    '❌ **Erro ao verificar pagamento!**\n\n' +
                    `Detalhes: ${error.message}\n\n` +
                    '💡 Tente novamente em alguns instantes ou entre em contato com um administrador.'
            });
        }
    }
});

// Evento: Erros
client.on('error', error => {
    console.error('❌ Erro no cliente Discord:', error);
});

process.on('unhandledRejection', error => {
    console.error('❌ Erro não tratado:', error);
});

// Login no Discord
client.login(process.env.DISCORD_TOKEN).catch(error => {
    console.error('❌ Erro ao fazer login no Discord:', error);
    process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Encerrando bot...');
    client.destroy();
    process.exit(0);
});

module.exports = client;
