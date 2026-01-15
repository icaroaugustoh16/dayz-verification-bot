const express = require('express');
const session = require('express-session');
const passport = require('passport');
const SteamStrategy = require('passport-steam').Strategy;
const { MongoClient } = require('mongodb');
const crypto = require('crypto');
const fs = require("fs");
const Discord = require('discord.js');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORT = process.env.VERIFICATION_PORT || 3002;

// Configuração
const config = {
    steam: {
        apiKey: process.env.STEAM_API_KEY,
        realm: process.env.STEAM_REALM || 'http://dayzapocalypse.duckdns.org:3002',
        returnURL: process.env.STEAM_RETURN_URL || 'http://dayzapocalypse.duckdns.org:3002/auth/steam/return'
    },
    discord: {
        botToken: process.env.DISCORD_TOKEN,
        guildId: process.env.GUILD_ID,
        verifiedRoleId: process.env.ROLE_VERIFIED
    },
    mongo: {
        url: process.env.MONGO_URL || 'mongodb://localhost:27017',
        dbName: process.env.DATABASE_NAME || 'dayz_server'
    },
    whitelist: {
        path: process.env.WHITELIST_PATH || 'C:/DayZServer1.28_TESTE/DayZServerModded_TESTE/whitelist.txt'
    }
};

let db;

// Conectar MongoDB
async function connectMongo() {
    const client = await MongoClient.connect(config.mongo.url);
    db = client.db(config.mongo.dbName);
}

// Configurar Passport
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(new SteamStrategy({
    returnURL: config.steam.returnURL,
    realm: config.steam.realm,
    apiKey: process.env.STEAM_API_KEY
}, (identifier, profile, done) => {
    profile.identifier = identifier;
    return done(null, profile);
}));

// Middleware
// Trust proxy para obter IP real quando atrás de nginx/cloudflare
app.set('trust proxy', true);

app.use(session({
    secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false,
        sameSite: 'lax'
    }
}));
app.use(passport.initialize());
app.use(passport.session());
app.use(express.json());
app.use(express.static('public'));

// ==================== ROTAS ====================

app.get('/', (req, res) => {
    res.json({
        status: 'online',
        service: 'DayZ Verification System',
        version: '1.0.1',
        endpoints: {
            verify: '/verify',
            steam_auth: '/auth/steam',
            steam_callback: '/auth/steam/return',
            launcher_register: '/api/security/register',
            update_nickname: '/api/update-nickname',
            player_security: '/api/player/:steamId'
        },
        timestamp: new Date()
    });
});

// ==================== PÁGINA INICIAL DE VERIFICAÇÃO ====================
app.get('/verify', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.send(`
        <!DOCTYPE html>
        <html lang="pt-BR">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Verificação - DayZ Apocalypse</title>
            <link rel="preconnect" href="https://fonts.googleapis.com">
            <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
            <link href="https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;600;700&display=swap" rel="stylesheet">
            <style>
                * {
                    margin: 0;
                    padding: 0;
                    box-sizing: border-box;
                }

                body {
                    font-family: 'Rajdhani', sans-serif;
                    background: linear-gradient(rgba(0,0,0,0.7), rgba(0,0,0,0.9)), 
                                url('https://wallpapercave.com/wp/wp2635152.jpg') center/cover fixed;
                    color: #fff;
                    min-height: 100vh;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 20px;
                }

                .container {
                    background: rgba(20, 20, 20, 0.95);
                    border: 2px solid #ff4444;
                    border-radius: 10px;
                    padding: 50px;
                    max-width: 600px;
                    width: 100%;
                    box-shadow: 0 0 40px rgba(255, 68, 68, 0.3),
                                inset 0 0 100px rgba(0,0,0,0.5);
                    backdrop-filter: blur(10px);
                    position: relative;
                    overflow: hidden;
                }

                .container::before {
                    content: '';
                    position: absolute;
                    top: -2px;
                    left: -2px;
                    right: -2px;
                    bottom: -2px;
                    background: linear-gradient(45deg, #ff4444, #cc0000, #ff4444);
                    z-index: -1;
                    filter: blur(10px);
                    opacity: 0.3;
                }

                .logo {
                    text-align: center;
                    margin-bottom: 30px;
                }

                .logo h1 {
                    font-size: 3rem;
                    font-weight: 700;
                    color: #ff4444;
                    text-shadow: 0 0 20px rgba(255, 68, 68, 0.8),
                                 0 0 40px rgba(255, 68, 68, 0.4);
                    letter-spacing: 3px;
                    margin-bottom: 10px;
                }

                .subtitle {
                    font-size: 1.3rem;
                    color: #aaa;
                    margin-bottom: 30px;
                    text-align: center;
                    letter-spacing: 2px;
                }

                .warning-box {
                    background: rgba(255, 68, 68, 0.1);
                    border-left: 4px solid #ff4444;
                    padding: 20px;
                    margin-bottom: 30px;
                    border-radius: 5px;
                }

                .warning-box p {
                    font-size: 1.1rem;
                    line-height: 1.6;
                    color: #ddd;
                }

                .steam-btn {
                    display: block;
                    background: linear-gradient(135deg, #171a21 0%, #2a475e 100%);
                    color: white;
                    padding: 20px 40px;
                    border-radius: 5px;
                    text-decoration: none;
                    font-weight: 700;
                    font-size: 1.3rem;
                    text-align: center;
                    transition: all 0.3s ease;
                    border: 2px solid #66c0f4;
                    box-shadow: 0 5px 20px rgba(102, 192, 244, 0.3);
                    letter-spacing: 1px;
                }

                .steam-btn:hover {
                    background: linear-gradient(135deg, #2a475e 0%, #171a21 100%);
                    transform: translateY(-3px);
                    box-shadow: 0 8px 30px rgba(102, 192, 244, 0.5);
                }

                .features {
                    margin-top: 30px;
                    padding-top: 30px;
                    border-top: 1px solid #333;
                }

                .feature-item {
                    display: flex;
                    align-items: center;
                    margin-bottom: 15px;
                    font-size: 1.1rem;
                }

                .feature-icon {
                    color: #ff4444;
                    margin-right: 15px;
                    font-size: 1.5rem;
                }

                @media (max-width: 768px) {
                    .container {
                        padding: 30px 20px;
                    }
                    
                    .logo h1 {
                        font-size: 2rem;
                    }
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="logo">
                    <h1>DayZ APOCALYPSE</h1>
                </div>
                
                <div class="subtitle">SISTEMA DE VERIFICAÇÃO</div>
                
                <div class="warning-box">
                    <p>Para ter acesso ao servidor, você precisa vincular sua conta Steam ao Discord. Este processo garante a segurança e autenticidade dos jogadores.</p>
                </div>
                
                <a href="/auth/steam" class="steam-btn">
                    ENTRAR COM STEAM
                </a>
                
                <div class="features">
                    <div class="feature-item">
                        <span class="feature-icon">✓</span>
                        <span>Processo rápido e seguro</span>
                    </div>
                    <div class="feature-item">
                        <span class="feature-icon">✓</span>
                        <span>Proteção contra banimentos injustos</span>
                    </div>
                    <div class="feature-item">
                        <span class="feature-icon">✓</span>
                        <span>Acesso imediato após verificação</span>
                    </div>
                </div>
            </div>
        </body>
        </html>
    `);
});

// ==================== PÁGINA DE CÓDIGO DE VERIFICAÇÃO ====================
// Use este template no callback do Steam (após gerar o código)
const htmlCodigoVerificacao = (code) => `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Código de Verificação - DayZ Apocalypse</title>
        <link href="https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;600;700&display=swap" rel="stylesheet">
        <style>
            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
            }

            body {
                font-family: 'Rajdhani', sans-serif;
                background: linear-gradient(rgba(0,0,0,0.8), rgba(0,0,0,0.95)), 
                            url('https://wallpapercave.com/wp/wp2635152.jpg') center/cover fixed;
                color: #fff;
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 20px;
            }

            .container {
                background: rgba(20, 20, 20, 0.95);
                border: 2px solid #00ff00;
                border-radius: 10px;
                padding: 50px;
                max-width: 700px;
                width: 100%;
                box-shadow: 0 0 40px rgba(0, 255, 0, 0.3),
                            inset 0 0 100px rgba(0,0,0,0.5);
                text-align: center;
            }

            .success-icon {
                font-size: 5rem;
                color: #00ff00;
                margin-bottom: 20px;
                text-shadow: 0 0 20px rgba(0, 255, 0, 0.8);
                animation: pulse 2s infinite;
            }

            @keyframes pulse {
                0%, 100% { transform: scale(1); }
                50% { transform: scale(1.1); }
            }

            h1 {
                font-size: 2.5rem;
                color: #00ff00;
                margin-bottom: 20px;
                text-shadow: 0 0 15px rgba(0, 255, 0, 0.6);
                letter-spacing: 2px;
            }

            .step-info {
                font-size: 1.3rem;
                color: #ddd;
                margin-bottom: 30px;
                line-height: 1.8;
            }

            .code-box {
                background: rgba(0, 0, 0, 0.6);
                border: 3px solid #00ff00;
                border-radius: 10px;
                padding: 40px;
                margin: 40px 0;
                position: relative;
                box-shadow: 0 0 30px rgba(0, 255, 0, 0.3),
                            inset 0 0 50px rgba(0, 255, 0, 0.1);
            }

            .code-label {
                font-size: 1.2rem;
                color: #00ff00;
                margin-bottom: 20px;
                letter-spacing: 2px;
            }

            .code {
                font-size: 4rem;
                font-weight: 700;
                color: #00ff00;
                letter-spacing: 15px;
                text-shadow: 0 0 20px rgba(0, 255, 0, 0.8);
                user-select: all;
                cursor: pointer;
                transition: all 0.3s;
            }

            .code:hover {
                color: #fff;
                text-shadow: 0 0 30px rgba(0, 255, 0, 1);
            }

            .instructions {
                background: rgba(255, 68, 68, 0.1);
                border-left: 4px solid #ff4444;
                padding: 20px;
                margin: 30px 0;
                text-align: left;
                border-radius: 5px;
            }

            .instructions h3 {
                color: #ff4444;
                margin-bottom: 15px;
                font-size: 1.5rem;
            }

            .instructions ol {
                margin-left: 20px;
                font-size: 1.2rem;
                line-height: 2;
            }

            .instructions li {
                color: #ddd;
                margin-bottom: 10px;
            }

            .timer {
                font-size: 1.1rem;
                color: #ff4444;
                margin-top: 30px;
                padding: 15px;
                background: rgba(255, 68, 68, 0.1);
                border-radius: 5px;
                border: 1px solid #ff4444;
            }

            @media (max-width: 768px) {
                .container {
                    padding: 30px 20px;
                }
                
                .code {
                    font-size: 2.5rem;
                    letter-spacing: 10px;
                }
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="success-icon">✓</div>
            
            <h1>AUTENTICAÇÃO CONCLUÍDA</h1>
            
            <div class="step-info">
                Sua conta Steam foi autenticada com sucesso!<br>
                Agora complete o processo no Discord.
            </div>
            
            <div class="code-box">
                <div class="code-label">SEU CÓDIGO DE VERIFICAÇÃO:</div>
                <div class="code" onclick="copyCode()" title="Clique para copiar">${code}</div>
            </div>
            
            <div class="instructions">
                <h3>PRÓXIMOS PASSOS:</h3>
                <ol>
                    <li>Volte para o Discord</li>
                    <li>Clique no botão <strong>"Finalizar Verificação"</strong></li>
                    <li>Cole o código acima quando solicitado</li>
                    <li>Aguarde a confirmação</li>
                </ol>
            </div>
            
            <div class="timer">
                ⏰ Este código expira em 10 minutos
            </div>
        </div>
        
        <script>
            function copyCode() {
                const code = document.querySelector('.code').textContent;
                navigator.clipboard.writeText(code).then(() => {
                    alert('Código copiado para a área de transferência!');
                });
            }
        </script>
    </body>
    </html>
`;

// ==================== PÁGINA DE CONTA JÁ LIBERADA ====================
const htmlContaLiberada = (existingPlayer, steamId) => `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Conta Liberada - DayZ Apocalypse</title>
        <link href="https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;600;700&display=swap" rel="stylesheet">
        <style>
            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
            }

            body {
                font-family: 'Rajdhani', sans-serif;
                background: linear-gradient(rgba(0,0,0,0.8), rgba(0,0,0,0.95)), 
                            url('https://wallpapercave.com/wp/wp2635152.jpg') center/cover fixed;
                color: #fff;
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 20px;
            }

            .container {
                background: rgba(20, 20, 20, 0.95);
                border: 2px solid #00ff00;
                border-radius: 10px;
                padding: 50px;
                max-width: 700px;
                width: 100%;
                box-shadow: 0 0 40px rgba(0, 255, 0, 0.3);
                text-align: center;
            }

            .icon {
                font-size: 6rem;
                margin-bottom: 20px;
                animation: bounce 2s infinite;
            }

            @keyframes bounce {
                0%, 100% { transform: translateY(0); }
                50% { transform: translateY(-20px); }
            }

            h1 {
                font-size: 2.5rem;
                color: #00ff00;
                margin-bottom: 20px;
                text-shadow: 0 0 15px rgba(0, 255, 0, 0.6);
            }

            .status {
                font-size: 1.5rem;
                color: #00ff00;
                margin-bottom: 30px;
                padding: 15px;
                background: rgba(0, 255, 0, 0.1);
                border-radius: 5px;
                letter-spacing: 2px;
            }

            .info-card {
                background: rgba(0, 0, 0, 0.5);
                border: 1px solid #333;
                border-radius: 10px;
                padding: 30px;
                margin: 30px 0;
                text-align: left;
            }

            .info-row {
                display: flex;
                justify-content: space-between;
                padding: 15px 0;
                border-bottom: 1px solid #222;
            }

            .info-row:last-child {
                border-bottom: none;
            }

            .info-label {
                color: #888;
                font-size: 1.1rem;
            }

            .info-value {
                color: #fff;
                font-size: 1.1rem;
                font-weight: 600;
            }

            .play-btn {
                display: inline-block;
                background: linear-gradient(135deg, #ff4444 0%, #cc0000 100%);
                color: white;
                padding: 20px 60px;
                border-radius: 5px;
                text-decoration: none;
                font-weight: 700;
                font-size: 1.5rem;
                margin-top: 30px;
                transition: all 0.3s;
                border: 2px solid #ff4444;
                box-shadow: 0 5px 20px rgba(255, 68, 68, 0.4);
                letter-spacing: 2px;
            }

            .play-btn:hover {
                transform: translateY(-3px);
                box-shadow: 0 8px 30px rgba(255, 68, 68, 0.6);
            }

            @media (max-width: 768px) {
                .container {
                    padding: 30px 20px;
                }
                
                .info-row {
                    flex-direction: column;
                    gap: 5px;
                }
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="icon">✓</div>
            
            <h1>CONTA JÁ LIBERADA</h1>
            
            <div class="status">
                VOCÊ JÁ ESTÁ VERIFICADO E PODE JOGAR
            </div>
            
            <div class="info-card">
                <div class="info-row">
                    <span class="info-label">Discord:</span>
                    <span class="info-value">${existingPlayer.discordTag || 'N/A'}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Steam ID:</span>
                    <span class="info-value">${steamId}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">GUID:</span>
                    <span class="info-value">${existingPlayer.guid}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">In-Game:</span>
                    <span class="info-value">${existingPlayer.name || 'Não jogou ainda'}</span>
                </div>
            </div>
            
            <p style="font-size: 1.3rem; color: #ddd; margin: 20px 0;">
                Abra o launcher e clique em PLAY para entrar no servidor!
            </p>
            
            <a href="https://www.dayzapocalypse.com" class="play-btn">
                IR PARA O SITE
            </a>
        </div>
    </body>
    </html>
`;


app.get('/auth/steam', passport.authenticate('steam', { failureRedirect: '/auth/failure' }));

app.get('/auth/steam/return', 
    passport.authenticate('steam', { failureRedirect: '/auth/failure' }),
    async (req, res) => {
        try {
            const steamId = req.user.id;
            const steamName = req.user.displayName;

            const existingPlayer = await db.collection('players').findOne({ 
                steamId: steamId,
                verified: true,
                launcherVerified: true,
                guid: { $ne: "pending" }
            });

            if (existingPlayer) {
                return res.send(htmlContaLiberada(existingPlayer, steamId));
            }

            const code = crypto.randomBytes(3).toString('hex').toUpperCase();

            await db.collection('verification_codes').createIndex({ "createdAt": 1 }, { expireAfterSeconds: 600 });
            await db.collection('verification_codes').insertOne({
                code: code,
                steamId: steamId,
                steamName: steamName,
                createdAt: new Date()
            });

            res.send(htmlCodigoVerificacao(code));

        } catch (error) {
            console.error('Erro no callback da Steam:', error);
            res.redirect('/auth/failure');
        }
    }
);

// ==================== API PARA LAUNCHER ====================

app.post('/api/security/register', async (req, res) => {
    try {
        const { primarySteamId, steamIds, serverAuth, ...securityData } = req.body;

        // Obter IP real da requisição (funciona com proxy reverso também)
        const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
                         req.headers['x-real-ip'] || 
                         req.connection?.remoteAddress || 
                         req.socket?.remoteAddress ||
                         req.ip || 
                         'unknown';

        // Verificar autenticação do servidor
        if (serverAuth !== process.env.SERVER_AUTH) {
            console.warn(`[LAUNCHER] Tentativa de registro não autorizada: ${clientIp}`);
            return res.status(401).json({ error: 'Unauthorized' });
        }

        if (!primarySteamId) {
            return res.status(400).json({ error: 'Primary Steam ID não fornecido' });
        }
        
        const existingPlayer = await db.collection('players').findOne({ steamId: primarySteamId });
        
        // ✅ SE JÁ ESTÁ COMPLETAMENTE VERIFICADO, apenas atualizar sessão
        if (existingPlayer && 
            existingPlayer.verified && 
            existingPlayer.launcherVerified && 
            existingPlayer.guid && 
            existingPlayer.guid !== "pending") {
            
            console.log(`[LAUNCHER] ${primarySteamId} JÁ VERIFICADO - Atualizando sessão | IP: ${clientIp}`);
            
            await db.collection('players').updateOne(
                { steamId: primarySteamId },
                {
                    $set: {
                        lastIp: clientIp,
                        lastLauncherCheck: new Date(),
                        lastLauncherVersion: securityData.launcherVersion
                    }
                }
            );
            
            return res.json({ 
                success: true,
                steamId: primarySteamId,
                guid: existingPlayer.guid,
                verified: true,
                canPlay: true,
                message: 'Conta já verificada - Pode jogar!'
            });
        }
        
        const updateData = {
            launcherVerified: true,
            guid: "pending",
            lastIp: clientIp,
            hardwareId: securityData.hardwareId,
            machineName: securityData.machineName,
            osVersion: securityData.osVersion,
            lastLauncherVersion: securityData.launcherVersion,
            knownSteamIds: steamIds,
            lastLauncherCheck: new Date(),
            macAddresses: securityData.macAddresses || [],
            motherboardSerial: securityData.motherboardSerial || "unknown",
            gpuId: securityData.gpuId || "unknown",
            diskSerials: securityData.diskSerials || [],
            cpuId: securityData.cpuId || "unknown",
            awaitingGuid: true
        };

        console.log(`[LAUNCHER] 🎮 Nova tentativa de conexão:`);
        console.log(`[LAUNCHER] → Steam ID: ${primarySteamId}`);
        console.log(`[LAUNCHER] → IP: ${clientIp}`);
        console.log(`[LAUNCHER] → Machine: ${securityData.machineName || 'Unknown'}`);
        console.log(`[LAUNCHER] → Launcher v${securityData.launcherVersion || '?'}`);
        
        await db.collection('players').updateOne(
            { steamId: primarySteamId },
            {
                $set: updateData,
                $setOnInsert: { 
                    steamId: primarySteamId,
                    verified: false, // Discord ainda não verificado
                    firstJoin: new Date(),
                    kills: 0,
                    deaths: 0,
                    playTime: 0,
                    online: false,
                    money: 10000,
                    clanId: null
                }
            },
            { upsert: true }
        );

        const playerData = await db.collection('players').findOne({ steamId: primarySteamId });

        // ✅ CRÍTICO: SÓ ADICIONA WHITELIST SE DISCORD VERIFICADO
        const canPlay = playerData.verified === true; // Precisa ter verificado no Discord
        
        // Verificar se é a primeira vez que esse jogador verificado acessa pelo launcher
        // (antes o launcherVerified era false/undefined, agora é true)
        const isFirstLauncherAccess = existingPlayer ? !existingPlayer.launcherVerified : true;

        if (canPlay) {
            addToWhitelist(primarySteamId, playerData.discordTag || 'Verified');
            
            // Enviar webhook APENAS na primeira vez que o jogador verificado acessa pelo launcher
            if (isFirstLauncherAccess) {
                // Montar dados de segurança com IP correto para webhook
                const webhookSecurityData = {
                    ...securityData,
                    ipAddress: clientIp,
                    launcherVersion: securityData.launcherVersion || 'unknown'
                };
                
                // Enviar webhook de verificação completa
                await sendCompleteVerificationWebhook(playerData, webhookSecurityData, steamIds || [primarySteamId]);
                console.log(`[LAUNCHER] ✅ ${primarySteamId} verificado e adicionado à whitelist (primeira vez)`);
            } else {
                console.log(`[LAUNCHER] ✅ ${primarySteamId} já verificado - aguardando GUID do servidor`);
            }
        } else {
            console.log(`[LAUNCHER] ⚠️ ${primarySteamId} registrado mas BLOQUEADO`);
            console.log(`[LAUNCHER] → Motivo: Discord não verificado (use /verificar no Discord)`);
            console.log(`[LAUNCHER] → Name: ${playerData.name || 'Sem nome'}`);
        }
        
        res.json({ 
            success: true,
            steamId: primarySteamId,
            guid: "pending",
            verified: canPlay,
            canPlay: canPlay,
            awaitingGuid: true,
            needsDiscordVerification: !canPlay, // Indica que precisa verificar Discord
            message: canPlay ? 'Pode jogar!' : 'Verifique sua conta no Discord primeiro'
        });

    } catch (error) {
        console.error('Erro:', error);
        res.status(500).json({ error: 'Erro interno' });
    }
});

function addToWhitelist(steamId, comment) {
    try {
        const whitelistPath = config.whitelist.path;

        if (!fs.existsSync(whitelistPath)) {
            fs.writeFileSync(whitelistPath, '');
            console.log(`[WHITELIST] Arquivo criado: ${whitelistPath}`);
        }

        const whitelistContent = fs.readFileSync(whitelistPath, 'utf8');
        if (!whitelistContent.includes(steamId)) {
            fs.appendFileSync(whitelistPath, `\n${steamId}\t//${comment}`);
            console.log(`[WHITELIST] ${steamId} adicionado`);
            return true;
        }
        return true;
    } catch (err) {
        console.error("[WHITELIST] Erro:", err.message);
        return false;
    }
}

// ==================== FUNÇÕES AUXILIARES ====================

async function sendCompleteVerificationWebhook(playerData, securityData, steamIds) {
    try {
        const webhookUrl = process.env.WEBHOOK_VERIFICATION || process.env.WEBHOOK_ADMIN;

        if (!webhookUrl) {
            console.warn('[WEBHOOK] WEBHOOK_VERIFICATION não configurado');
            return;
        }

        const webhookClient = new Discord.WebhookClient({ url: webhookUrl });
        
        const otherSteamIds = steamIds.filter(id => id !== playerData.steamId);
        const otherAccountsString = otherSteamIds.length > 0 
            ? otherSteamIds.map(id => `• \`${id}\``).join('\n')
            : 'Nenhuma';

        const macString = (securityData.macAddresses || []).map(mac => `\`${mac}\``).join(', ') || 'N/A';
        const diskString = (securityData.diskSerials || []).map(disk => `\`${disk}\``).join(', ') || 'N/A';

        const embed = new Discord.EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('✅ VERIFICAÇÃO COMPLETA - Acesso Liberado')
            .setDescription(`**Steam ID:** \`${playerData.steamId}\`\n**GUID:** \`${playerData.guid}\``)
            .addFields(
                { 
                    name: '👤 Jogador', 
                    value: `**Discord:** \`${playerData.discordTag || 'N/A'}\`\n**Steam:** \`${playerData.steamName || 'N/A'}\`\n**In-Game:** ${playerData.name || 'Ainda não jogou'}`,
                    inline: false
                },
                { 
                    name: '🆔 Identificadores', 
                    value: `**Discord ID:** \`${playerData.discordId || 'N/A'}\`\n**Steam ID:** \`${playerData.steamId}\`\n**GUID DayZ:** \`${playerData.guid || 'pending'}\``,
                    inline: false
                },
                { 
                    name: '💻 Máquina', 
                    value: `**HWID:** \`${playerData.hardwareId || 'N/A'}\`\n**IP:** \`${playerData.lastIp || securityData.ipAddress || 'N/A'}\`\n**PC:** \`${playerData.machineName || 'N/A'}\``,
                    inline: false 
                },
                { 
                    name: '🔧 Hardware', 
                    value: `**MACs:** ${macString}\n**GPU:** \`${playerData.gpuId || 'N/A'}\`\n**Motherboard:** \`${playerData.motherboardSerial || 'N/A'}\`\n**CPU:** \`${playerData.cpuId || 'N/A'}\``,
                    inline: false 
                },
                { 
                    name: '💾 Discos', 
                    value: diskString,
                    inline: false 
                },
                { 
                    name: '🎮 Stats', 
                    value: `**K/D:** ${playerData.kills || 0}/${playerData.deaths || 0}\n**Dinheiro:** $${playerData.money || 0}\n**Tempo:** ${Math.floor((playerData.playTime || 0) / 60)}h`,
                    inline: false
                },
                { 
                    name: '🔎 Outras Contas', 
                    value: otherAccountsString,
                    inline: false 
                }
            )
            .setFooter({ text: `Launcher v${securityData.launcherVersion || 'unknown'}` })
            .setTimestamp();
        
        await webhookClient.send({ embeds: [embed] });
        console.log(`[WEBHOOK] Verificação completa enviada para ${playerData.steamId}`);
    } catch (error) {
        console.error('Erro ao enviar webhook:', error);
    }
}

// ==================== PÁGINA DE ERRO ====================
app.get('/auth/failure', (req, res) => {
    res.status(401).send(`
        <!DOCTYPE html>
        <html lang="pt-BR">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Erro - DayZ Apocalypse</title>
            <link href="https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;600;700&display=swap" rel="stylesheet">
            <style>
                * {
                    margin: 0;
                    padding: 0;
                    box-sizing: border-box;
                }

                body {
                    font-family: 'Rajdhani', sans-serif;
                    background: linear-gradient(rgba(0,0,0,0.9), rgba(0,0,0,0.95)), 
                                url('https://wallpapercave.com/wp/wp2635152.jpg') center/cover fixed;
                    color: #fff;
                    min-height: 100vh;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 20px;
                }

                .container {
                    background: rgba(20, 20, 20, 0.95);
                    border: 2px solid #ff4444;
                    border-radius: 10px;
                    padding: 50px;
                    max-width: 600px;
                    width: 100%;
                    box-shadow: 0 0 40px rgba(255, 68, 68, 0.4);
                    text-align: center;
                }

                .error-icon {
                    font-size: 6rem;
                    color: #ff4444;
                    margin-bottom: 20px;
                    animation: shake 0.5s infinite;
                }

                @keyframes shake {
                    0%, 100% { transform: translateX(0); }
                    25% { transform: translateX(-10px); }
                    75% { transform: translateX(10px); }
                }

                h1 {
                    font-size: 2.5rem;
                    color: #ff4444;
                    margin-bottom: 20px;
                    text-shadow: 0 0 15px rgba(255, 68, 68, 0.6);
                }

                p {
                    font-size: 1.3rem;
                    color: #ddd;
                    line-height: 1.8;
                    margin-bottom: 30px;
                }

                .retry-btn {
                    display: inline-block;
                    background: linear-gradient(135deg, #ff4444 0%, #cc0000 100%);
                    color: white;
                    padding: 15px 40px;
                    border-radius: 5px;
                    text-decoration: none;
                    font-weight: 700;
                    font-size: 1.2rem;
                    transition: all 0.3s;
                    border: 2px solid #ff4444;
                    letter-spacing: 1px;
                }

                .retry-btn:hover {
                    transform: translateY(-3px);
                    box-shadow: 0 8px 30px rgba(255, 68, 68, 0.6);
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="error-icon">✗</div>
                <h1>AUTENTICAÇÃO FALHOU</h1>
                <p>
                    A autenticação com a Steam não foi concluída.<br>
                    Isso pode ter ocorrido porque você cancelou o login<br>
                    ou houve um erro na comunicação.
                </p>
                <a href="/verify" class="retry-btn">TENTAR NOVAMENTE</a>
            </div>
        </body>
        </html>
    `);
});

// ==================== ENDPOINT PARA ATUALIZAR NICKNAME ====================

app.post('/api/update-nickname', async (req, res) => {
    try {
        const { steamId, oldNickname, newNickname, serverAuth } = req.body;
        
        // Obter IP real da requisição
        const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
                         req.headers['x-real-ip'] || 
                         req.connection?.remoteAddress || 
                         req.socket?.remoteAddress ||
                         req.ip || 
                         'unknown';

        // Validar autenticação
        if (serverAuth !== process.env.SERVER_AUTH) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        if (!steamId || !newNickname) {
            return res.status(400).json({ error: 'Steam ID e novo nickname são obrigatórios' });
        }

        // Buscar player no banco
        const player = await db.collection('players').findOne({ steamId: steamId });

        if (!player) {
            return res.status(404).json({ error: 'Player não encontrado' });
        }

        const previousNickname = oldNickname || player.nickname || 'Nenhum';
        
        // Atualizar nickname e IP no banco
        await db.collection('players').updateOne(
            { steamId: steamId },
            {
                $set: {
                    name: newNickname,
                    nickname: newNickname,
                    nicknameUpdatedAt: new Date(),
                    lastIp: clientIp  // Atualizar IP também
                },
                $push: {
                    nicknameHistory: {
                        oldNickname: previousNickname,
                        newNickname: newNickname,
                        changedAt: new Date(),
                        ip: clientIp
                    }
                }
            }
        );

        console.log(`[NICKNAME] ${steamId} alterou: "${previousNickname}" → "${newNickname}" | IP: ${clientIp}`);

        // Atualizar player com IP para o webhook
        const playerWithIp = { ...player, lastIp: clientIp };
        
        // Enviar webhook
        await sendNicknameChangeWebhook(playerWithIp, previousNickname, newNickname);

        // Registrar log de mudança
        await db.collection('logs').insertOne({
            type: 'nickname_change',
            steamId: steamId,
            discordId: player.discordId,
            discordTag: player.discordTag,
            oldNickname: previousNickname,
            newNickname: newNickname,
            ip: clientIp,
            timestamp: new Date()
        });

        res.json({ 
            success: true,
            message: 'Nickname atualizado com sucesso',
            oldNickname: previousNickname,
            newNickname: newNickname
        });

    } catch (error) {
        console.error('Erro ao atualizar nickname:', error);
        res.status(500).json({ error: 'Erro interno' });
    }
});

// ==================== WEBHOOK DE MUDANÇA DE NICKNAME ====================

async function sendNicknameChangeWebhook(player, oldNickname, newNickname) {
    try {
        const webhookUrl = process.env.NICKNAME_WEBHOOK_URL;

        if (!webhookUrl) {
            console.warn('[WEBHOOK] NICKNAME_WEBHOOK_URL não configurado');
            return;
        }

        const webhookClient = new Discord.WebhookClient({ url: webhookUrl });

        const embed = new Discord.EmbedBuilder()
            .setColor('#3498db')
            .setTitle('📝 Nickname Alterado')
            .setDescription('Um jogador alterou seu nickname no launcher')
            .addFields(
                { name: '👤 Discord', value: player.discordTag || 'N/A', inline: true },
                { name: '🆔 Steam ID', value: `\`${player.steamId}\``, inline: true },
                { name: '🔑 GUID', value: `\`${player.guid || 'pending'}\``, inline: true },
                { name: '📛 Nickname Anterior', value: `\`${oldNickname}\``, inline: true },
                { name: '✏️ Novo Nickname', value: `\`${newNickname}\``, inline: true },
                { name: '📡 IP', value: `\`${player.lastIp || 'N/A'}\``, inline: true }
            )
            .setFooter({ text: 'Sistema de Rastreamento' })
            .setTimestamp();

        await webhookClient.send({ embeds: [embed] });
        console.log(`[WEBHOOK] Mudança de nickname registrada: ${player.steamId}`);
    } catch (error) {
        console.error('Erro ao enviar webhook de nickname:', error);
    }
}

// ==================== ENDPOINT DE SEGURANÇA DO LAUNCHER ====================

// Rate limiter para endpoint de player (proteção contra spam)
const playerApiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minuto
    max: 30, // máximo 30 requisições por minuto
    message: { error: 'Muitas requisições. Tente novamente em alguns instantes.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Endpoint para buscar informações de player por SteamID
// Usado pelo sistema de segurança do launcher para alertas de engenharia reversa
app.get('/api/player/:steamId', playerApiLimiter, async (req, res) => {
    try {
        const steamId = req.params.steamId;

        // Validar SteamID (17 dígitos)
        if (!/^\d{17}$/.test(steamId)) {
            return res.status(400).json({
                error: 'SteamID inválido. Deve conter exatamente 17 dígitos.'
            });
        }

        // Buscar player no MongoDB
        const player = await db.collection('players').findOne({
            steamId: steamId
        });

        if (!player) {
            console.log(`[API] Player não encontrado: ${steamId}`);
            return res.status(404).json({
                error: 'Player não encontrado'
            });
        }

        // Determinar nickname (prioridade: name > nickname > steamName)
        const nickname = player.name || player.nickname || player.steamName || 'Desconhecido';

        // Determinar lastSeen (prioridade: lastLogin > verifiedAt > lastUpdate)
        const lastSeen = player.lastLogin || player.verifiedAt || player.lastUpdate || null;

        // Retornar dados do player no formato esperado pelo launcher
        const response = {
            steamId: player.steamId,
            nickname: nickname,
            discordId: player.discordId || null,
            lastIP: player.lastIp || null,
            lastSeen: lastSeen,
            isBanned: player.isBanned || false,
            banReason: player.banReason || null
        };

        res.json(response);

        console.log(`[API] Player encontrado: ${nickname} (${steamId})`);
    } catch (error) {
        console.error('[API] Erro ao buscar player:', error);
        res.status(500).json({
            error: 'Erro interno do servidor'
        });
    }
});

// Iniciar servidor
async function startServer() {
    await connectMongo();
    
    app.listen(PORT, () => {
        console.log(`✅ Verificação: http://localhost:${PORT}`);
    });
}

startServer().catch(console.error);