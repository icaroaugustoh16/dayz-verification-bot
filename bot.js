// ================================================
// BOT DE VERIFICAÇÃO - SISTEMA MODERNO COM SLASH COMMANDS
// ================================================
const { Client, GatewayIntentBits, Collection, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// ========== CONFIGURAÇÃO ==========
const config = {
    discord: {
        token: process.env.DISCORD_TOKEN,
        clientId: process.env.CLIENT_ID,
        guildId: process.env.GUILD_ID,
    },
    mongo: {
        url: process.env.MONGO_URL || 'mongodb://localhost:27017',
        dbName: process.env.DATABASE_NAME || 'dayz_server'
    },
    roles: {
        verified: process.env.ROLE_VERIFIED || 'Verificado',
    },
    channels: {
        killfeed: process.env.KILLFEED_CHANNEL_ID
    }
};

// ========== CLIENTE DISCORD ==========
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
    ]
});

client.commands = new Collection();
let db;

// ========== CONECTAR MONGODB ==========
async function connectMongo() {
    try {
        const mongoClient = await MongoClient.connect(config.mongo.url);
        db = mongoClient.db(config.mongo.dbName);
        console.log('✅ Conectado ao MongoDB');
    } catch (error) {
        console.error('❌ Erro ao conectar MongoDB:', error);
        process.exit(1);
    }
}

// ========== CARREGAR COMANDOS SLASH ==========
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    
    if ('data' in command && 'execute' in command) {
        client.commands.set(command.data.name, command);
        console.log(`✅ Comando carregado: /${command.data.name}`);
    } else {
        console.log(`⚠️ Comando ${file} sem 'data' ou 'execute'`);
    }
}

// ========== EVENTO: BOT PRONTO ==========
client.once('ready', async () => {
    console.log('\n╔════════════════════════════════════════╗');
    console.log(`║  ✅ Bot online: ${client.user.tag.padEnd(22)}  ║`);
    console.log('╚════════════════════════════════════════╝\n');
    
    client.user.setPresence({
        activities: [{ name: 'DayZ Apocalypse | /servidor', type: 0 }],
        status: 'online'
    });

    await connectMongo();
});

// ========== INTERAÇÕES: SLASH COMMANDS ==========
client.on('interactionCreate', async (interaction) => {
    // ===== SLASH COMMANDS =====
    if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);

        if (!command) {
            return interaction.reply({ 
                content: '❌ Comando não encontrado.', 
                ephemeral: true 
            });
        }

        try {
            await command.execute(interaction, db);
        } catch (error) {
            console.error(`Erro ao executar /${interaction.commandName}:`, error);
            
            const errorMsg = { 
                content: '❌ Erro ao executar o comando.', 
                ephemeral: true 
            };

            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(errorMsg);
            } else {
                await interaction.reply(errorMsg);
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

        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

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

            const playerData = await db.collection('players').findOne({ steamId: steamId });
            await db.collection('verification_codes').deleteOne({ code });

            // ✅ ADICIONAR À WHITELIST IMEDIATAMENTE
            try {
                const whitelistPath = process.env.WHITELIST_PATH;
                if (fs.existsSync(whitelistPath)) {
                    const whitelistContent = fs.readFileSync(whitelistPath, 'utf8');
                    if (!whitelistContent.includes(steamId)) {
                        fs.appendFileSync(whitelistPath, `\n${steamId}\t//${discordUser.tag}`);
                        console.log(`[WHITELIST] ${steamId} adicionado`);
                    }
                }
            } catch (err) {
                console.error("ERRO WHITELIST:", err);
            }

            let message = '';
            if (userAccounts.length > 0) {
                message = `✅ **Conta adicional vinculada!**\n\nVocê agora tem **${userAccounts.length + 1} contas** verificadas.\n\n`;
            } else {
                message = `✅ **Primeira conta verificada!**\n\n`;
            }

            if (playerData.launcherVerified) {
                // Dar cargo de verificado
                const member = await guild.members.fetch(discordUser.id);
                const verifiedRole = guild.roles.cache.find(role => role.name === config.roles.verified);
                if (member && verifiedRole) {
                    await member.roles.add(verifiedRole);
                }

                await interaction.editReply({ 
                    content: message + '🎮 **Verificação Completa!** Você já pode entrar no servidor.\n\n' +
                            '📝 Abra o launcher e clique em **PLAY**.'
                });
            } else {
                await interaction.editReply({ 
                    content: message + '🔑 **Discord verificado!** Agora abra o launcher para completar.\n\n' +
                            '⚠️ **Importante:** Abra o launcher antes de tentar jogar.'
                });
            }

        } catch (error) {
            console.error('Erro no modal de verificação:', error);
            await interaction.editReply({ content: '❌ Erro ao processar. Contate um administrador.' });
        }
    }
});

// ========== COMANDO LEGADO: !setupverificacao (ÚNICO COMANDO COM PREFIXO) ==========
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.content.startsWith('!setupverificacao')) return;

    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return message.reply('❌ Apenas administradores.');
    }

    const verifyUrl = `${process.env.VERIFICATION_URL || 'http://dayzapocalypse.duckdns.org:3002'}/verify`;

    const setupEmbed = new EmbedBuilder()
        .setColor('#ff0000')
        .setTitle('✅ Sistema de Verificação de Conta')
        .setDescription('Para ter acesso completo ao servidor e poder jogar, siga os passos abaixo.')
        .addFields(
            { name: '1️⃣ Inicie a Verificação', value: 'Clique no botão **"Verificar com a Steam"** para ser direcionado ao nosso site de verificação segura e fazer login com sua conta Steam.' },
            { name: '2️⃣ Receba seu Código', value: 'Após o login, você receberá um código de uso único na tela.' },
            { name: '3️⃣ Finalize a Verificação', value: 'Clique no botão **"Finalizar Verificação"** aqui no Discord, cole o código recebido e clique em "Enviar".' }
        )
        .setImage('https://cdn.discordapp.com/attachments/1037080854951899247/1422668119331307610/APOCALYPSE_TAMANHO_DISCORD_1920X1080.png')
        .setFooter({ text: 'DayZ Apocalypse Protect' });

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

    await message.delete();
    await message.channel.send({ embeds: [setupEmbed], components: [row] });
});

// ========== TRATAMENTO DE ERROS ==========
process.on('unhandledRejection', error => {
    console.error('❌ Unhandled promise rejection:', error);
});

client.on('error', error => {
    console.error('❌ Discord client error:', error);
});

// ========== GRACEFUL SHUTDOWN ==========
process.on('SIGINT', () => {
    console.log('\n\n⏹️  Encerrando bot...');
    client.destroy();
    process.exit(0);
});

// ========== LOGIN ==========
client.login(config.discord.token);
