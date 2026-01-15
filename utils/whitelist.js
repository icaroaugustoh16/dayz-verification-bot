const fs = require('fs');

/**
 * Adiciona um Steam ID à whitelist do servidor
 * @param {string} steamId - Steam ID 64 do jogador
 * @param {string} comment - Comentário (geralmente Discord tag ou nome)
 * @returns {boolean} - true se adicionado com sucesso, false em caso de erro
 */
function addToWhitelist(steamId, comment = 'Added by system') {
    try {
        const whitelistPath = process.env.WHITELIST_PATH;

        if (!whitelistPath) {
            console.error('[WHITELIST] WHITELIST_PATH não configurado no .env');
            return false;
        }

        if (!fs.existsSync(whitelistPath)) {
            console.error(`[WHITELIST] Arquivo não encontrado: ${whitelistPath}`);
            return false;
        }

        const whitelistContent = fs.readFileSync(whitelistPath, 'utf8');

        // Verificar se já existe
        if (whitelistContent.includes(steamId)) {
            console.log(`[WHITELIST] ${steamId} já está na whitelist`);
            return true;
        }

        // Adicionar à whitelist
        const newEntry = `\n${steamId}\t//${comment}`;
        fs.appendFileSync(whitelistPath, newEntry);

        console.log(`[WHITELIST] ✅ ${steamId} adicionado → ${comment}`);
        return true;
    } catch (error) {
        console.error('[WHITELIST] Erro ao adicionar:', error.message);
        return false;
    }
}

/**
 * Remove um Steam ID da whitelist
 * @param {string} steamId - Steam ID 64 do jogador
 * @returns {boolean} - true se removido com sucesso
 */
function removeFromWhitelist(steamId) {
    try {
        const whitelistPath = process.env.WHITELIST_PATH;

        if (!whitelistPath || !fs.existsSync(whitelistPath)) {
            console.error('[WHITELIST] Arquivo não encontrado');
            return false;
        }

        let content = fs.readFileSync(whitelistPath, 'utf8');
        const lines = content.split('\n');

        // Filtrar linhas que não contêm o Steam ID
        const filteredLines = lines.filter(line => !line.includes(steamId));

        if (filteredLines.length === lines.length) {
            console.log(`[WHITELIST] ${steamId} não estava na whitelist`);
            return false;
        }

        fs.writeFileSync(whitelistPath, filteredLines.join('\n'));
        console.log(`[WHITELIST] ✅ ${steamId} removido`);
        return true;
    } catch (error) {
        console.error('[WHITELIST] Erro ao remover:', error.message);
        return false;
    }
}

/**
 * Verifica se um Steam ID está na whitelist
 * @param {string} steamId - Steam ID 64 do jogador
 * @returns {boolean} - true se está na whitelist
 */
function isWhitelisted(steamId) {
    try {
        const whitelistPath = process.env.WHITELIST_PATH;

        if (!whitelistPath || !fs.existsSync(whitelistPath)) {
            return false;
        }

        const content = fs.readFileSync(whitelistPath, 'utf8');
        return content.includes(steamId);
    } catch (error) {
        console.error('[WHITELIST] Erro ao verificar:', error.message);
        return false;
    }
}

module.exports = {
    addToWhitelist,
    removeFromWhitelist,
    isWhitelisted
};
