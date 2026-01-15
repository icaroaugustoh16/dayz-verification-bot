const fs = require('fs');
const path = require('path');
const Discord = require('discord.js');

/**
 * Adiciona coins para um jogador (sistema de loja)
 * @param {string} steamId - Steam ID do jogador
 * @param {string} playerName - Nome do jogador
 * @param {string} discordId - Discord ID do jogador
 * @param {number} quantidade - Quantidade de coins
 * @param {string} motivo - Motivo da adição
 * @param {object} db - Instância do MongoDB
 * @param {object} discordClient - Cliente Discord (para enviar DM)
 * @returns {object} - { success, oldBalance, newBalance, error }
 */
async function addCoins(steamId, playerName, discordId, quantidade, motivo = 'Sistema automático', db = null, discordClient = null) {
    try {
        const playerDataDir = process.env.COINS_DATA_DIR || 'C:\\DayZServer1.28_TESTE\\DayZServerModded_TESTE\\Profiles\\ModsSparda\\Store\\PlayerAccounts';
        const playerDataPath = path.join(playerDataDir, `${steamId}.json`);

        // Criar diretório se não existir
        if (!fs.existsSync(playerDataDir)) {
            fs.mkdirSync(playerDataDir, { recursive: true });
            console.log(`[COINS] Diretório criado: ${playerDataDir}`);
        }

        let playerData;
        if (fs.existsSync(playerDataPath)) {
            const rawData = fs.readFileSync(playerDataPath, 'utf8');
            playerData = JSON.parse(rawData);
        } else {
            // Criar arquivo inicial com formato do mod
            playerData = {
                steamid: steamId,
                coins: 0
            };
            console.log(`[COINS] Criando novo arquivo para ${steamId}`);
        }

        const oldBalance = playerData.coins || 0;
        playerData.coins = oldBalance + quantidade;

        // Salvar arquivo com formato exato do mod
        fs.writeFileSync(playerDataPath, JSON.stringify(playerData, null, 4), 'utf8');
        console.log(`[COINS] ✅ ${steamId}: ${oldBalance} → ${playerData.coins} coins (+${quantidade})`);

        // Salvar log no MongoDB
        if (db) {
            try {
                await db.collection('logs').insertOne({
                    type: 'coins_add',
                    steamId: steamId,
                    discordId: discordId,
                    playerName: playerName,
                    quantidade: quantidade,
                    saldoAnterior: oldBalance,
                    novoSaldo: playerData.coins,
                    motivo: motivo,
                    timestamp: new Date()
                });
            } catch (err) {
                console.error('[COINS] Erro ao salvar log no MongoDB:', err.message);
            }
        }

        // Enviar DM ao jogador (se discordClient disponível)
        if (discordClient && discordId) {
            try {
                const user = await discordClient.users.fetch(discordId);
                
                const embed = new Discord.EmbedBuilder()
                    .setColor('#ffd700')
                    .setTitle('🎉 Você Recebeu Coins!')
                    .setDescription('Obrigado por fazer parte do nosso servidor!')
                    .addFields(
                        { name: '💰 Quantidade Recebida', value: `**+${quantidade} coins**`, inline: true },
                        { name: '💸 Novo Saldo', value: `**${playerData.coins} coins**`, inline: true },
                        { name: '📝 Motivo', value: motivo, inline: false },
                        { name: '🛒 Como Usar', value: 'Entre no servidor e segure a tecla **"I"** para abrir a loja!', inline: false }
                    )
                    .setTimestamp()
                    .setFooter({ text: 'DayZ Apocalypse - Sistema de Coins' });

                await user.send({ embeds: [embed] });
                console.log(`[COINS] DM enviada para ${user.tag}`);
            } catch (err) {
                console.log(`[COINS] Não foi possível enviar DM para ${discordId}: ${err.message}`);
            }
        }

        return {
            success: true,
            oldBalance: oldBalance,
            newBalance: playerData.coins,
            playerData: playerData
        };

    } catch (error) {
        console.error('[COINS] Erro ao adicionar coins:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Obter saldo de coins de um jogador
 * @param {string} steamId - Steam ID do jogador
 * @returns {number} - Saldo atual de coins
 */
function getCoins(steamId) {
    try {
        const playerDataDir = process.env.COINS_DATA_DIR || 'C:\\DayZServer1.28_TESTE\\DayZServerModded_TESTE\\Profiles\\ModsSparda\\Store\\PlayerAccounts';
        const playerDataPath = path.join(playerDataDir, `${steamId}.json`);

        if (!fs.existsSync(playerDataPath)) {
            return 0;
        }

        const rawData = fs.readFileSync(playerDataPath, 'utf8');
        const playerData = JSON.parse(rawData);

        return playerData.coins || 0;
    } catch (error) {
        console.error('[COINS] Erro ao obter saldo:', error.message);
        return 0;
    }
}


/**
 * Remove coins de um jogador
 * @param {string} steamId - Steam ID do jogador
 * @param {number} quantidade - Quantidade de coins a remover
 * @param {string} motivo - Motivo da remoção
 * @param {object} db - Instância do MongoDB
 * @returns {object} - { success, oldBalance, newBalance, error }
 */
async function removeCoins(steamId, quantidade, motivo = 'Remoção manual', db = null) {
    try {
        const playerDataDir = process.env.COINS_DATA_DIR || 'C:\\DayZServer1.28_TESTE\\DayZServerModded_TESTE\\Profiles\\ModsSparda\\Store\\PlayerAccounts';
        const playerDataPath = path.join(playerDataDir, `${steamId}.json`);

        if (!fs.existsSync(playerDataPath)) {
            console.log(`[COINS] Arquivo não existe para ${steamId}`);
            return {
                success: false,
                error: 'Player não possui coins'
            };
        }

        const rawData = fs.readFileSync(playerDataPath, 'utf8');
        const playerData = JSON.parse(rawData);

        const oldBalance = playerData.coins || 0;
        playerData.coins = Math.max(0, oldBalance - quantidade); // Não permite negativo

        // Salvar arquivo
        fs.writeFileSync(playerDataPath, JSON.stringify(playerData, null, 4), 'utf8');
        console.log(`[COINS] ✅ ${steamId}: ${oldBalance} → ${playerData.coins} coins (-${quantidade})`);

        // Salvar log no MongoDB
        if (db) {
            try {
                await db.collection('logs').insertOne({
                    type: 'coins_remove',
                    steamId: steamId,
                    quantidade: quantidade,
                    saldoAnterior: oldBalance,
                    novoSaldo: playerData.coins,
                    motivo: motivo,
                    timestamp: new Date()
                });
            } catch (err) {
                console.error('[COINS] Erro ao salvar log no MongoDB:', err.message);
            }
        }

        return {
            success: true,
            oldBalance: oldBalance,
            newBalance: playerData.coins
        };

    } catch (error) {
        console.error('[COINS] Erro ao remover coins:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

module.exports = {
    addCoins,
    removeCoins,
    getCoins
};
