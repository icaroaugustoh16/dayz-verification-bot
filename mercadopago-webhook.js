require('dotenv').config();
const express = require('express');
const { EventEmitter } = require('events');
const { getDb } = require('./utils/database');
const { getPaymentStatus, validateWebhook, formatCurrency } = require('./utils/mercadopago');
const { addCoins } = require('./utils/coins');
const Discord = require('discord.js');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// EventEmitter para comunicação com o bot
const paymentEvents = new EventEmitter();

// Cliente Discord para enviar notificações
let discordClient = null;
let database = null;

// Configurar cliente Discord (compartilhado do bot-new.js)
function setDiscordClient(client) {
    discordClient = client;
    console.log('✅ Cliente Discord configurado no webhook server');
}

// Configurar banco de dados MongoDB
function setDatabase(db) {
    database = db;
    console.log('✅ MongoDB configurado no webhook server');
}

/**
 * Webhook do Mercado Pago
 * Recebe notificações de pagamentos aprovados
 */
app.post('/mercadopago/webhook', async (req, res) => {
    try {
        console.log('\n🔔 [WEBHOOK] Notificação recebida do Mercado Pago');
        console.log('Body:', JSON.stringify(req.body, null, 2));

        // ===== VALIDAÇÃO DE SEGURANÇA (OPCIONAL EM PRODUÇÃO) =====
        // Verificar x-signature header para garantir que é do Mercado Pago
        const xSignature = req.headers['x-signature'];
        const xRequestId = req.headers['x-request-id'];
        
        if (process.env.NODE_ENV === 'production' && process.env.ENABLE_WEBHOOK_VALIDATION === 'true') {
            if (!xSignature || !xRequestId) {
                console.warn('⚠️ [WEBHOOK] Requisição sem assinatura, possivelmente inválida');
                return res.status(401).send('Unauthorized');
            }
            
            // Validar assinatura (implementar validateWebhook na utils/mercadopago.js)
            // const isValid = await validateWebhook(req.body, xSignature, xRequestId);
            // if (!isValid) {
            //     console.error('❌ [WEBHOOK] Assinatura inválida!');
            //     return res.status(401).send('Unauthorized');
            // }
        }

        // Responder rapidamente ao Mercado Pago (evita reenvios)
        res.status(200).send('OK');

        // Novo formato: { topic: "payment" | "merchant_order", resource: "URL" }
        // Antigo formato: { type: "payment", data: { id: "123" } }
        
        const topic = req.body.topic || req.body.type;
        const resourceUrl = req.body.resource;
        const dataId = req.body.data?.id;

        if (!topic) {
            console.warn('⚠️ [WEBHOOK] Notificação sem topic/type');
            return;
        }

        console.log(`📋 [WEBHOOK] Topic: ${topic}`);

        // Processar notificação de forma assíncrona
        if (topic === 'payment') {
            // Formato novo: extrair ID da URL
            if (resourceUrl) {
                const paymentId = resourceUrl.split('/').pop();
                console.log(`🔍 [WEBHOOK] Payment ID extraído da URL: ${paymentId}`);
                await processPaymentNotification({ data: { id: paymentId } });
            }
            // Formato antigo: usar data.id
            else if (dataId) {
                await processPaymentNotification({ data: { id: dataId } });
            }
        } else if (topic === 'merchant_order') {
            console.log('📦 [WEBHOOK] Merchant Order recebida, ignorando (processamos apenas payments)');
        }

    } catch (error) {
        console.error('❌ [WEBHOOK] Erro ao processar notificação:', error);
    }
});

/**
 * Processa notificação de pagamento
 */
async function processPaymentNotification(notification) {
    try {
        const paymentId = notification.data.id;
        console.log(`🔍 [WEBHOOK] Verificando status do pagamento ${paymentId}...`);

        // Aguardar 5 segundos antes de consultar (sandbox demora mais)
        console.log(`⏱️ [WEBHOOK] Aguardando 5s para o MP processar...`);
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Consultar status completo do pagamento com retry
        let paymentInfo;
        let attempts = 0;
        const maxAttempts = 5; // Aumentado para 5 tentativas

        while (attempts < maxAttempts) {
            try {
                paymentInfo = await getPaymentStatus(paymentId);
                console.log(`📊 [WEBHOOK] Status: ${paymentInfo.status}`);
                break; // Sucesso, sair do loop
            } catch (error) {
                attempts++;
                if (attempts >= maxAttempts) {
                    console.error(`❌ [WEBHOOK] Falhou após ${maxAttempts} tentativas`);
                    throw error; // Última tentativa falhou
                }
                console.log(`⚠️ [WEBHOOK] Tentativa ${attempts}/${maxAttempts} falhou, aguardando 5s...`);
                await new Promise(resolve => setTimeout(resolve, 5000)); // 5s entre tentativas
            }
        }

        if (!paymentInfo) {
            throw new Error('Não foi possível obter informações do pagamento após múltiplas tentativas');
        }

        // Verificar se banco está conectado
        if (!database) {
            console.error('⚠️ Banco de dados não conectado');
            return;
        }

        // Buscar pagamento no banco
        const payment = await database.collection('payments').findOne({ 
            paymentId: parseInt(paymentId) 
        });

        if (!payment) {
            console.warn(`⚠️ [WEBHOOK] Pagamento ${paymentId} não encontrado no banco`);
            return;
        }

        // Se já foi processado, ignorar
        if (payment.status === 'approved' && payment.processed) {
            console.log(`✅ [WEBHOOK] Pagamento ${paymentId} já foi processado anteriormente`);
            return;
        }

        // Processar apenas pagamentos aprovados
        if (paymentInfo.status === 'approved') {
            console.log(`💰 [WEBHOOK] Pagamento ${paymentId} APROVADO! Processando...`);

            // Buscar dados do player no MongoDB
            const player = await database.collection('players').findOne({ 
                steamId: payment.steamId 
            });

            // Adicionar coins ao player (usando mesma lógica do coins-add.js)
            const totalCoins = payment.coins + payment.bonus;
            
            // Determinar diretório baseado no servidor escolhido
            let playerDataDir;
            if (payment.serverType === 'vanilla') {
                playerDataDir = process.env.COINS_DATA_DIR_VANILLA || 'C:\\DayZServer1.28_TESTE\\DayZServerVanilla_TESTE\\Profiles\\ModsSparda\\Store\\PlayerAccounts';
            } else {
                // fullmod (padrão)
                playerDataDir = process.env.COINS_DATA_DIR || 'C:\\DayZServer1.28_TESTE\\DayZServerModded_TESTE\\Profiles\\ModsSparda\\Store\\PlayerAccounts';
            }
            
            const serverDisplayName = payment.serverName || (payment.serverType === 'vanilla' ? 'Vanilla' : 'FullMod');
            
            const path = require('path');
            const fs = require('fs');
            const playerDataPath = path.join(playerDataDir, `${payment.steamId}.json`);

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
                    steamid: payment.steamId,
                    coins: 0
                };
            }

            const saldoAnterior = parseInt(playerData.coins) || 0;
            playerData.coins = saldoAnterior + totalCoins;

            // Garantir que steamid está no formato correto
            playerData.steamid = payment.steamId;

            // Salvar arquivo atualizado (formato exato do mod)
            fs.writeFileSync(playerDataPath, JSON.stringify(playerData, null, 4), 'utf8');
            console.log(`✅ [WEBHOOK] ${totalCoins} coins adicionados para ${payment.steamId} no servidor ${serverDisplayName} (${saldoAnterior} → ${playerData.coins})`);

            // Atualizar coins no MongoDB também
            await database.collection('players').updateOne(
                { steamId: payment.steamId },
                { 
                    $set: { 
                        coins: playerData.coins,
                        updatedAt: new Date()
                    } 
                }
            );

            // Atualizar status do pagamento
            await database.collection('payments').updateOne(
                { paymentId: parseInt(paymentId) },
                {
                    $set: {
                        status: 'approved',
                        processed: true,
                        approvedAt: new Date(paymentInfo.date_approved),
                        processedAt: new Date()
                    }
                }
            );

            // Registrar no log de transações
            await database.collection('logs').insertOne({
                type: 'payment_approved',
                userId: payment.userId,
                steamId: payment.steamId,
                paymentId: paymentId,
                packageId: payment.packageId,
                coins: payment.coins,
                bonus: payment.bonus,
                totalCoins: totalCoins,
                saldoAnterior: saldoAnterior,
                novoSaldo: playerData.coins,
                amount: payment.amount,
                timestamp: new Date()
            });

            // Enviar notificação no Discord
            await sendPaymentNotification(payment, paymentInfo);
            
            // Emitir evento para o bot editar mensagem ephemeral
            paymentEvents.emit('paymentApproved', {
                paymentId: payment.paymentId,
                userId: payment.userId,
                steamId: payment.steamId,
                packageName: payment.packageName,
                coins: payment.coins,
                bonus: payment.bonus,
                totalCoins: totalCoins,
                amount: payment.amount,
                newBalance: playerData.coins
            });
            
            console.log(`📡 [WEBHOOK] Evento 'paymentApproved' emitido para paymentId ${payment.paymentId}`);

        } else if (paymentInfo.status === 'rejected' || paymentInfo.status === 'cancelled') {
            console.log(`❌ [WEBHOOK] Pagamento ${paymentId} ${paymentInfo.status.toUpperCase()}`);

            await database.collection('payments').updateOne(
                { paymentId: parseInt(paymentId) },
                {
                    $set: {
                        status: paymentInfo.status,
                        statusDetail: paymentInfo.status_detail,
                        updatedAt: new Date()
                    }
                }
            );
        } else if (paymentInfo.status === 'charged_back' || paymentInfo.status === 'refunded') {
            // ⚠️ ESTORNO DETECTADO! Alerta crítico
            console.log(`🚨 [CHARGEBACK] ESTORNO DETECTADO para pagamento ${paymentId}!`);
            
            await handleChargeback(payment, paymentInfo);
        }

    } catch (error) {
        console.error('❌ [WEBHOOK] Erro ao processar pagamento:', error);
    }
}

/**
 * Processa estornos/chargebacks
 */
async function handleChargeback(payment, paymentInfo) {
    try {
        if (!database) {
            console.error('⚠️ Banco de dados não conectado');
            return;
        }
        
        const { getCoins, removeCoins } = require('./utils/coins');

        console.log(`🚨 [CHARGEBACK] Processando estorno do pagamento #${payment.paymentId}`);

        // Verificar saldo atual do player
        const currentCoins = await getCoins(payment.steamId);
        const coinsReceived = payment.totalCoins;
        const coinsSpent = coinsReceived - currentCoins;
        const hasSpent = coinsSpent > 0;

        // Registrar estorno no banco
        await database.collection('chargebacks').insertOne({
            paymentId: payment.paymentId,
            userId: payment.userId,
            steamId: payment.steamId,
            amount: payment.amount,
            coinsReceived: coinsReceived,
            currentCoins: currentCoins,
            coinsSpent: coinsSpent,
            hasSpent: hasSpent,
            detectedAt: new Date(),
            status: 'pending_review',
            paymentStatus: paymentInfo.status
        });

        // Atualizar status do pagamento
        await database.collection('payments').updateOne(
            { paymentId: payment.paymentId },
            {
                $set: {
                    status: paymentInfo.status,
                    chargebackDetected: true,
                    chargebackDate: new Date(),
                    updatedAt: new Date()
                }
            }
        );

        // Remover coins restantes automaticamente
        if (currentCoins > 0) {
            await removeCoins(
                payment.steamId, 
                currentCoins, 
                `Estorno do pagamento #${payment.paymentId}`,
                db
            );
            console.log(`🚨 [CHARGEBACK] ${currentCoins} coins removidos de ${payment.steamId}`);
        }

        // ALERTA CRÍTICO NO DISCORD
        await sendChargebackAlert(payment, currentCoins, coinsSpent, hasSpent);

        console.log(`🚨 [CHARGEBACK] Estorno processado para pagamento #${payment.paymentId}`);

    } catch (error) {
        console.error('❌ [CHARGEBACK] Erro ao processar estorno:', error);
    }
}

/**
 * Envia alerta de estorno para canal de segurança
 */
async function sendChargebackAlert(payment, currentCoins, coinsSpent, hasSpent) {
    try {
        const WEBHOOK_FRAUDS = process.env.WEBHOOK_FRAUDS;
        
        if (!WEBHOOK_FRAUDS) {
            console.warn('⚠️ [CHARGEBACK] Webhook de fraudes não configurado (WEBHOOK_FRAUDS)');
            return;
        }

        const axios = require('axios');
        
        // Buscar informações completas do player
        const player = await database.collection('players').findOne({ steamId: payment.steamId });
        
        const playerInfo = player ? {
            steamName: player.steamName || 'Desconhecido',
            ingameName: player.name || 'Nunca jogou',
            kills: player.kills || 0,
            deaths: player.deaths || 0,
            kdRatio: player.kdRatio ? player.kdRatio.toFixed(2) : '0.00',
            zombieKills: player.zombieKills || 0,
            playTime: player.playTime || 0,
            money: player.money || 0,
            firstJoin: player.firstJoin ? new Date(player.firstJoin).toLocaleDateString('pt-BR') : 'N/A',
            lastSeen: player.lastSeen ? new Date(player.lastSeen).toLocaleDateString('pt-BR') : 'N/A',
            verified: player.verified ? '✅ Sim' : '❌ Não',
            online: player.online ? '🟢 Online' : '⚪ Offline'
        } : null;

        const playTimeFormatted = playerInfo ? 
            `${Math.floor(playerInfo.playTime / 60)}h ${playerInfo.playTime % 60}m` : 'N/A';
        
        const riskLevel = hasSpent ? '🔴 ALTO' : '🟡 MÉDIO';
        const riskColor = hasSpent ? 0xFF0000 : 0xFFA500;
        const percentSpent = payment.totalCoins > 0 ? ((coinsSpent / payment.totalCoins) * 100).toFixed(1) : '0.0';
        
        const alertEmbed = {
            title: '🚨 ALERTA DE ESTORNO DETECTADO',
            description: 
                '**Um pagamento foi estornado pelo Mercado Pago!**\n\n' +
                (hasSpent 
                    ? '⚠️ **ATENÇÃO:** O player JÁ GASTOU parte ou todos os coins!'
                    : '✅ Coins ainda não foram gastos. Já foram removidos automaticamente.'),
            color: riskColor,
            fields: [
                {
                    name: '💳 ID do Pagamento',
                    value: `#${payment.paymentId}`,
                    inline: true
                },
                {
                    name: '⚠️ Nível de Risco',
                    value: riskLevel,
                    inline: true
                },
                {
                    name: '💰 Valor Estornado',
                    value: formatCurrency(payment.amount),
                    inline: true
                },
                {
                    name: '👤 Player Discord',
                    value: `<@${payment.userId}>`,
                    inline: true
                },
                {
                    name: '🆔 Steam ID',
                    value: `\`${payment.steamId}\``,
                    inline: true
                },
                {
                    name: '📦 Pacote Estornado',
                    value: payment.packageName,
                    inline: true
                },
                {
                    name: '🪙 Coins Recebidos',
                    value: `${payment.totalCoins}`,
                    inline: true
                },
                {
                    name: '💼 Saldo Atual',
                    value: `${currentCoins}`,
                    inline: true
                },
                {
                    name: '📉 Coins Gastos',
                    value: `${coinsSpent} (${percentSpent}%)`,
                    inline: true
                }
            ],
            footer: {
                text: 'Sistema Anti-Fraude | DayZ Apocalypse'
            },
            timestamp: new Date().toISOString()
        };

        // Adicionar informações do player
        if (playerInfo) {
            alertEmbed.fields.push(
                {
                    name: '\u200b',
                    value: '**═══════════════ INFORMAÇÕES DO PLAYER ═══════════════**',
                    inline: false
                },
                {
                    name: '🎮 Nome Steam',
                    value: playerInfo.steamName,
                    inline: true
                },
                {
                    name: '🎯 Nome In-Game',
                    value: playerInfo.ingameName,
                    inline: true
                },
                {
                    name: '✅ Verificado',
                    value: playerInfo.verified,
                    inline: true
                },
                {
                    name: '💵 Dinheiro (Money)',
                    value: `$${playerInfo.money}`,
                    inline: true
                },
                {
                    name: '⚔️ Kills / 💀 Deaths',
                    value: `${playerInfo.kills} / ${playerInfo.deaths}`,
                    inline: true
                },
                {
                    name: '📊 K/D Ratio',
                    value: `${playerInfo.kdRatio}`,
                    inline: true
                },
                {
                    name: '🧟 Zombie Kills',
                    value: `${playerInfo.zombieKills}`,
                    inline: true
                },
                {
                    name: '⏱️ Tempo de Jogo',
                    value: playTimeFormatted,
                    inline: true
                },
                {
                    name: '🔌 Status',
                    value: playerInfo.online,
                    inline: true
                },
                {
                    name: '� Primeira Entrada',
                    value: playerInfo.firstJoin,
                    inline: true
                },
                {
                    name: '👁️ Última Vez Visto',
                    value: playerInfo.lastSeen,
                    inline: true
                }
            );
        }

        // Adicionar ações tomadas e recomendações
        alertEmbed.fields.push(
            {
                name: '\u200b',
                value: '**═══════════════════════════════════════════**',
                inline: false
            },
            {
                name: '🔒 Ações Tomadas Automaticamente',
                value: 
                    '✅ Coins restantes foram **removidos automaticamente**\n' +
                    '✅ Registro salvo na collection `chargebacks`\n' +
                    '✅ Pagamento marcado como `charged_back`',
                inline: false
            },
            {
                name: '⚖️ Próximas Ações Recomendadas',
                value: hasSpent
                    ? '❌ **Player usou coins de forma fraudulenta**\n' +
                      '1. Revisar caso no MongoDB (`chargebacks` collection)\n' +
                      '2. Considerar banimento permanente do player\n' +
                      '3. Adicionar à lista negra de fraudes\n' +
                      '4. Investigar outras compras deste player'
                    : '✅ **Nenhuma ação urgente necessária**\n' +
                      'Coins foram removidos antes de serem utilizados.\n' +
                      'Monitorar player para futuras tentativas.',
                inline: false
            }
        );

        await axios.post(WEBHOOK_FRAUDS, {
            content: '@here 🚨 **ALERTA CRÍTICO DE ESTORNO**',
            embeds: [alertEmbed]
        });

        console.log(`🚨 [CHARGEBACK] Alerta enviado via webhook de fraudes`);

    } catch (error) {
        console.error('❌ [CHARGEBACK] Erro ao enviar alerta:', error);
    }
}

/**
 * Envia notificação de pagamento aprovado no Discord
 */
async function sendPaymentNotification(payment, paymentInfo) {
    try {
        if (!discordClient) {
            console.warn('⚠️ [WEBHOOK] Cliente Discord não configurado');
            return;
        }

        const totalCoins = payment.coins + payment.bonus;
        const bonusText = payment.bonus > 0 ? `\n+ **${payment.bonus} BÔNUS** 🎁` : '';

        // Buscar saldo atual do player
        const player = await database.collection('players').findOne({ steamId: payment.steamId });
        const currentBalance = player?.coins || 0;

        // 1. Enviar DM para o player
        try {
            const user = await discordClient.users.fetch(payment.userId);
            
            const dmEmbed = new Discord.EmbedBuilder()
                .setColor('#00FF00')
                .setTitle('✅ Pagamento Aprovado!')
                .setDescription(
                    `**Obrigado pela sua compra!**\n\n` +
                    `💰 **+${totalCoins} coins** foram adicionados à sua conta!\n\n` +
                    `**Saldo atual: ${currentBalance} coins**`
                )
                .addFields(
                    { 
                        name: '📦 Pacote Adquirido', 
                        value: `${payment.packageName}`, 
                        inline: true 
                    },
                    { 
                        name: '� Valor Pago', 
                        value: formatCurrency(payment.amount), 
                        inline: true 
                    },
                    { 
                        name: '🪙 Detalhes', 
                        value: `Coins: ${payment.coins}\nBônus: ${payment.bonus}\n**Total: ${totalCoins} coins**`, 
                        inline: false 
                    },
                    {
                        name: '🎮 Como Usar',
                        value: 'Entre no servidor e pressione **"i"** para abrir a loja in-game!',
                        inline: false
                    }
                )
                .setFooter({ text: `ID da Transação: ${payment.paymentId}` })
                .setTimestamp();

            await user.send({ embeds: [dmEmbed] });
            console.log(`📬 [WEBHOOK] DM enviada para ${user.tag}`);

        } catch (dmError) {
            console.error('⚠️ [WEBHOOK] Não foi possível enviar DM:', dmError.message);
        }

        // 2. Enviar log via webhook dedicado de compras
        const WEBHOOK_PURCHASES = process.env.WEBHOOK_PURCHASES;
        
        if (WEBHOOK_PURCHASES) {
            try {
                const axios = require('axios');
                
                // Buscar informações completas do player
                const player = await database.collection('players').findOne({ steamId: payment.steamId });
                
                const playerInfo = player ? {
                    steamName: player.steamName || 'Desconhecido',
                    ingameName: player.name || 'Nunca jogou',
                    kills: player.kills || 0,
                    deaths: player.deaths || 0,
                    kdRatio: player.kdRatio ? player.kdRatio.toFixed(2) : '0.00',
                    zombieKills: player.zombieKills || 0,
                    playTime: player.playTime || 0,
                    previousCoins: (player.coins || 0) - totalCoins,
                    newCoins: player.coins || 0,
                    money: player.money || 0,
                    firstJoin: player.firstJoin ? new Date(player.firstJoin).toLocaleDateString('pt-BR') : 'N/A',
                    verified: player.verified ? '✅ Sim' : '❌ Não',
                    online: player.online ? '🟢 Online' : '⚪ Offline'
                } : null;

                const playTimeFormatted = playerInfo ? 
                    `${Math.floor(playerInfo.playTime / 60)}h ${playerInfo.playTime % 60}m` : 'N/A';

                const purchaseServerEmoji = payment.serverType === 'vanilla' ? '🌿' : '🔧';
                const purchaseServerName = payment.serverName || (payment.serverType === 'vanilla' ? 'Vanilla' : 'FullMod');
                
                const logEmbed = {
                    title: '💰 Nova Compra de Coins',
                    color: 0xFFD700,
                    fields: [
                        {
                            name: '👤 Player Discord',
                            value: `<@${payment.userId}>`,
                            inline: true
                        },
                        {
                            name: '🆔 Steam ID',
                            value: `\`${payment.steamId}\``,
                            inline: true
                        },
                        {
                            name: '💳 ID Pagamento',
                            value: `#${payment.paymentId}`,
                            inline: true
                        },
                        {
                            name: '🎮 Servidor Destino',
                            value: `${purchaseServerEmoji} **${purchaseServerName}**`,
                            inline: true
                        },
                        {
                            name: '📦 Pacote Adquirido',
                            value: payment.packageName,
                            inline: true
                        },
                        {
                            name: '💵 Valor Pago',
                            value: formatCurrency(payment.amount),
                            inline: true
                        },
                        {
                            name: '🪙 Coins Recebidos',
                            value: `${payment.coins} + ${payment.bonus} bônus = **${totalCoins} total**`,
                            inline: true
                        }
                    ],
                    footer: {
                        text: `Sistema de Pagamentos - Servidor: ${purchaseServerName}`
                    },
                    timestamp: new Date().toISOString()
                };

                // Adicionar informações do player se disponível
                if (playerInfo) {
                    logEmbed.fields.push(
                        {
                            name: '\u200b',
                            value: '**═══════════════ INFORMAÇÕES DO PLAYER ═══════════════**',
                            inline: false
                        },
                        {
                            name: '� Nome Steam',
                            value: playerInfo.steamName,
                            inline: true
                        },
                        {
                            name: '🎯 Nome In-Game',
                            value: playerInfo.ingameName,
                            inline: true
                        },
                        {
                            name: '✅ Verificado',
                            value: playerInfo.verified,
                            inline: true
                        },
                        {
                            name: '🪙 Coins Anterior',
                            value: `${playerInfo.previousCoins}`,
                            inline: true
                        },
                        {
                            name: '🪙 Coins Atual',
                            value: `**${playerInfo.newCoins}**`,
                            inline: true
                        },
                        {
                            name: '� Dinheiro (Money)',
                            value: `$${playerInfo.money}`,
                            inline: true
                        },
                        {
                            name: '⚔️ Kills',
                            value: `${playerInfo.kills}`,
                            inline: true
                        },
                        {
                            name: '💀 Deaths',
                            value: `${playerInfo.deaths}`,
                            inline: true
                        },
                        {
                            name: '📊 K/D Ratio',
                            value: `${playerInfo.kdRatio}`,
                            inline: true
                        },
                        {
                            name: '🧟 Zombie Kills',
                            value: `${playerInfo.zombieKills}`,
                            inline: true
                        },
                        {
                            name: '⏱️ Tempo de Jogo',
                            value: playTimeFormatted,
                            inline: true
                        },
                        {
                            name: '📅 Primeira Entrada',
                            value: playerInfo.firstJoin,
                            inline: true
                        },
                        {
                            name: '🔌 Status',
                            value: playerInfo.online,
                            inline: true
                        }
                    );
                }

                await axios.post(WEBHOOK_PURCHASES, {
                    embeds: [logEmbed]
                });

                console.log(`📊 [WEBHOOK] Log de compra enviado via webhook`);

            } catch (webhookError) {
                console.error('⚠️ [WEBHOOK] Erro ao enviar log via webhook:', webhookError.message);
            }
        }

    } catch (error) {
        console.error('❌ [WEBHOOK] Erro ao enviar notificações:', error);
    }
}

/**
 * Endpoint de teste
 */
app.get('/health', (req, res) => {
    res.json({ 
        status: 'online', 
        service: 'Mercado Pago Webhook',
        timestamp: new Date().toISOString()
    });
});

/**
 * Endpoint para simular webhook (apenas para testes)
 */
app.post('/test/webhook', async (req, res) => {
    if (process.env.NODE_ENV !== 'development') {
        return res.status(403).send('Forbidden');
    }

    console.log('🧪 [TEST] Simulando webhook de pagamento aprovado...');
    
    const testNotification = {
        type: 'payment',
        data: { id: req.body.paymentId || '123456789' }
    };

    await processPaymentNotification(testNotification);
    res.json({ message: 'Test webhook processed' });
});

// Iniciar servidor
const PORT = process.env.WEBHOOK_PORT || 3003;

function startWebhookServer() {
    app.listen(PORT, () => {
        console.log(`\n🌐 Webhook Server rodando na porta ${PORT}`);
        console.log(`📡 Endpoint: http://localhost:${PORT}/mercadopago/webhook`);
        console.log(`❤️ Health check: http://localhost:${PORT}/health\n`);
    });
}

/**
 * Envia logs detalhados de cada etapa do processo de compra
 */
async function sendDetailedLog(eventType, data) {
    try {
        const WEBHOOK_PURCHASES = process.env.WEBHOOK_PURCHASES;
        if (!WEBHOOK_PURCHASES) return;

        const axios = require('axios');
        
        let logEmbed = {
            timestamp: new Date().toISOString()
        };

        switch (eventType) {
            case 'package_selected':
                logEmbed = {
                    title: '📦 Pacote Selecionado',
                    description: `${data.userTag} está visualizando o pacote **${data.packageName}**`,
                    color: 0x3498DB,
                    fields: [
                        { name: '👤 Usuário', value: `<@${data.userId}>`, inline: true },
                        { name: '🆔 Steam ID', value: `\`${data.steamId}\``, inline: true },
                        { name: '📦 Pacote', value: data.packageName, inline: true },
                        { name: '💵 Valor', value: formatCurrency(data.amount), inline: true },
                        { name: '🪙 Coins', value: `${data.coins}`, inline: true },
                        { name: '🎯 Etapa', value: '1/4 - Seleção', inline: true }
                    ],
                    footer: { text: 'Início do processo de compra' },
                    timestamp: new Date().toISOString()
                };
                break;

            case 'terms_accepted':
                logEmbed = {
                    title: '✅ Termos Aceitos',
                    description: `${data.userTag} aceitou os termos de serviço`,
                    color: 0x2ECC71,
                    fields: [
                        { name: '👤 Usuário', value: `<@${data.userId}>`, inline: true },
                        { name: '📦 Pacote', value: data.packageName, inline: true },
                        { name: '💵 Valor', value: formatCurrency(data.amount), inline: true },
                        { name: '🎯 Etapa', value: '2/4 - Termos', inline: true }
                    ],
                    footer: { text: 'Termos aceitos - escolhendo servidor' },
                    timestamp: new Date().toISOString()
                };
                break;

            case 'server_selected':
                const selectedServerEmoji = data.serverType === 'vanilla' ? '🌿' : '🔧';
                const selectedServerName = data.serverName || (data.serverType === 'vanilla' ? 'Vanilla' : 'FullMod');
                logEmbed = {
                    title: '🎮 Servidor Selecionado',
                    description: `${data.userTag} escolheu o servidor **${selectedServerEmoji} ${selectedServerName}**`,
                    color: 0xFF6B00,
                    fields: [
                        { name: '👤 Usuário', value: `<@${data.userId}>`, inline: true },
                        { name: '🆔 Steam ID', value: `\`${data.steamId}\``, inline: true },
                        { name: '📦 Pacote', value: data.packageName, inline: true },
                        { name: '🎮 Servidor Escolhido', value: `${selectedServerEmoji} **${selectedServerName}**`, inline: true },
                        { name: '💵 Valor', value: formatCurrency(data.amount), inline: true },
                        { name: '🎯 Etapa', value: '3/5 - Servidor', inline: true }
                    ],
                    footer: { text: `Servidor selecionado: ${selectedServerName} - Escolhendo forma de pagamento` },
                    timestamp: new Date().toISOString()
                };
                break;

            case 'payment_method_selected':
                const serverEmoji = data.serverType === 'vanilla' ? '🌿' : '🔧';
                const serverDisplayName = data.serverName || (data.serverType === 'vanilla' ? 'Vanilla' : 'FullMod');
                logEmbed = {
                    title: '💳 Método de Pagamento Escolhido',
                    description: `${data.userTag} escolheu pagar com **${data.method}**`,
                    color: 0xF39C12,
                    fields: [
                        { name: '👤 Usuário', value: `<@${data.userId}>`, inline: true },
                        { name: '📦 Pacote', value: data.packageName, inline: true },
                        { name: '🎮 Servidor', value: `${serverEmoji} ${serverDisplayName}`, inline: true },
                        { name: '💳 Método', value: data.method, inline: true },
                        { name: '💵 Valor', value: formatCurrency(data.amount), inline: true },
                        { name: '🎯 Etapa', value: '4/5 - Método', inline: true }
                    ],
                    footer: { text: 'Gerando pagamento...' },
                    timestamp: new Date().toISOString()
                };
                break;

            case 'payment_created':
                const createdServerEmoji = data.serverType === 'vanilla' ? '🌿' : '🔧';
                const createdServerName = data.serverName || (data.serverType === 'vanilla' ? 'Vanilla' : 'FullMod');
                logEmbed = {
                    title: '🔄 Pagamento Criado',
                    description: `Pagamento ${data.method} gerado para ${data.userTag}`,
                    color: 0x9B59B6,
                    fields: [
                        { name: '👤 Usuário', value: `<@${data.userId}>`, inline: true },
                        { name: '💳 ID Pagamento', value: `#${data.paymentId}`, inline: true },
                        { name: '🎮 Servidor', value: `${createdServerEmoji} ${createdServerName}`, inline: true },
                        { name: '📦 Pacote', value: data.packageName, inline: true },
                        { name: '💵 Valor', value: formatCurrency(data.amount), inline: true },
                        { name: '💳 Método', value: data.method, inline: true },
                        { name: '⏰ Status', value: '⏳ Aguardando pagamento', inline: true },
                        { name: '🎯 Etapa', value: '5/5 - Aguardando', inline: true }
                    ],
                    footer: { text: 'Pagamento pendente' },
                    timestamp: new Date().toISOString()
                };
                break;

            case 'payment_cancelled':
                const cancelServerEmoji = data.serverType === 'vanilla' ? '🌿' : '🔧';
                const cancelServerName = data.serverName || (data.serverType === 'vanilla' ? 'Vanilla' : 'FullMod');
                logEmbed = {
                    title: '❌ Pagamento Cancelado',
                    description: `${data.userTag} cancelou o pagamento durante o processo`,
                    color: 0xE74C3C,
                    fields: [
                        { name: '👤 Usuário', value: `<@${data.userId}>`, inline: true },
                        { name: '💳 ID Pagamento', value: `#${data.paymentId}`, inline: true },
                        { name: '🎮 Servidor', value: `${cancelServerEmoji} ${cancelServerName}`, inline: true },
                        { name: '📦 Pacote', value: data.packageName, inline: true },
                        { name: '💵 Valor', value: formatCurrency(data.amount), inline: true },
                        { name: '💳 Método', value: data.paymentMethod || 'N/A', inline: true },
                        { name: '📍 Etapa Cancelada', value: data.cancelStep || 'Não especificada', inline: true }
                    ],
                    footer: { text: 'Compra não finalizada - Etapa 5/5' },
                    timestamp: new Date().toISOString()
                };
                break;

            case 'manual_verification':
                logEmbed = {
                    title: '🔍 Verificação Manual',
                    description: `${data.userTag} clicou em "Verificar Pagamento"`,
                    color: 0x1ABC9C,
                    fields: [
                        { name: '👤 Usuário', value: `<@${data.userId}>`, inline: true },
                        { name: '💳 ID Pagamento', value: `#${data.paymentId}`, inline: true },
                        { name: '📊 Status no MP', value: data.status, inline: true }
                    ],
                    footer: { text: 'Verificação manual solicitada' },
                    timestamp: new Date().toISOString()
                };
                break;

            case 'purchase_cancelled_at_terms':
            case 'purchase_cancelled':
                const stepInfo = {
                    'Termos de Serviço': { title: 'Etapa de Termos', step: '2/4' },
                    'Forma de Pagamento': { title: 'Seleção de Pagamento', step: '3/4' },
                    'Desconhecido': { title: 'Etapa Desconhecida', step: '?/4' }
                };
                
                const currentStep = stepInfo[data.cancelStep] || stepInfo['Desconhecido'];
                
                logEmbed = {
                    title: `❌ Cancelado na ${currentStep.title}`,
                    description: `${data.userTag} cancelou a compra na etapa: **${data.cancelStep}**`,
                    color: 0xE67E22,
                    fields: [
                        { name: '👤 Usuário', value: `<@${data.userId}>`, inline: true },
                        { name: '🆔 Steam ID', value: data.steamId ? `\`${data.steamId}\`` : 'N/A', inline: true },
                        { name: '📍 Etapa Cancelada', value: data.cancelStep, inline: true },
                        { name: '⚠️ Motivo', value: 'Usuário clicou em "❌ Cancelar"', inline: false }
                    ],
                    footer: { text: `Compra não finalizada - Etapa ${currentStep.step}` },
                    timestamp: new Date().toISOString()
                };
                break;
        }

        // Adicionar informações do player se disponível
        if (data.player) {
            const p = data.player;
            
            // Buscar saldo REAL do arquivo JSON do mod
            const fs = require('fs');
            const path = require('path');
            let realCoins = 0;
            try {
                const playerDataDir = process.env.COINS_DATA_DIR || 'C:\\DayZServer1.28_TESTE\\DayZServerModded_TESTE\\Profiles\\ModsSparda\\Store\\PlayerAccounts';
                const playerDataPath = path.join(playerDataDir, `${p.steamId}.json`);
                if (fs.existsSync(playerDataPath)) {
                    const rawData = fs.readFileSync(playerDataPath, 'utf8');
                    const playerData = JSON.parse(rawData);
                    realCoins = playerData.coins || 0;
                }
            } catch (error) {
                console.error('[LOG] Erro ao ler coins do arquivo:', error.message);
                realCoins = p.coins || 0; // Fallback para MongoDB
            }
            
            logEmbed.fields = logEmbed.fields || [];
            logEmbed.fields.push(
                { name: '\u200b', value: '**─── Informações do Player ───**', inline: false },
                { name: '🎮 Nome Steam', value: p.steamName || 'N/A', inline: true },
                { name: '💰 Saldo Coins', value: `${realCoins}`, inline: true },
                { name: '💵 Money', value: `$${p.money || 0}`, inline: true },
                { name: '⚔️ K/D', value: `${p.kills || 0}/${p.deaths || 0}`, inline: true },
                { name: '✅ Verificado', value: p.verified ? 'Sim' : 'Não', inline: true },
                { name: '🔌 Status', value: p.online ? '🟢 Online' : '⚪ Offline', inline: true }
            );
        }

        await axios.post(WEBHOOK_PURCHASES, {
            embeds: [logEmbed]
        });

    } catch (error) {
        console.error('[LOG] Erro ao enviar log detalhado:', error.message);
    }
}

module.exports = { 
    app, 
    startWebhookServer, 
    setDiscordClient,
    setDatabase,
    sendDetailedLog,
    paymentEvents
};
