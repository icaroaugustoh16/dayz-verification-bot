/**
 * Valida se uma string é um Steam ID 64 válido
 * @param {string} steamId - ID para validar
 * @returns {boolean} - true se válido
 */
function isValidSteamId(steamId) {
    if (!steamId || typeof steamId !== 'string') {
        return false;
    }

    // Steam ID 64 deve começar com 765 e ter 17 dígitos
    return /^765\d{14}$/.test(steamId);
}

/**
 * Valida se uma string é um Discord ID válido
 * @param {string} discordId - ID para validar
 * @returns {boolean} - true se válido
 */
function isValidDiscordId(discordId) {
    if (!discordId || typeof discordId !== 'string') {
        return false;
    }

    // Discord IDs são snowflakes de 17-19 dígitos
    return /^\d{17,19}$/.test(discordId);
}

/**
 * Valida se uma string é um GUID DayZ válido
 * @param {string} guid - GUID para validar
 * @returns {boolean} - true se válido
 */
function isValidGuid(guid) {
    if (!guid || typeof guid !== 'string') {
        return false;
    }

    // GUID DayZ é hexadecimal de 32 caracteres
    return /^[a-f0-9]{32}$/i.test(guid);
}

/**
 * Valida se uma string é um código de verificação válido
 * @param {string} code - Código para validar
 * @returns {boolean} - true se válido
 */
function isValidVerificationCode(code) {
    if (!code || typeof code !== 'string') {
        return false;
    }

    // Código de verificação: 6 caracteres alfanuméricos maiúsculos
    return /^[A-Z0-9]{6}$/.test(code);
}

/**
 * Sanitiza entrada do usuário removendo caracteres perigosos
 * @param {string} input - String para sanitizar
 * @returns {string} - String sanitizada
 */
function sanitizeInput(input) {
    if (!input || typeof input !== 'string') {
        return '';
    }

    // Remove caracteres especiais perigosos
    return input
        .replace(/[<>\"'`]/g, '')  // XSS básico
        .replace(/[\r\n]/g, '')    // Quebras de linha
        .trim();
}

/**
 * Valida se um IP é válido (IPv4)
 * @param {string} ip - IP para validar
 * @returns {boolean} - true se válido
 */
function isValidIp(ip) {
    if (!ip || typeof ip !== 'string') {
        return false;
    }

    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (!ipv4Regex.test(ip)) {
        return false;
    }

    // Verificar se cada octeto está entre 0 e 255
    const octets = ip.split('.');
    return octets.every(octet => {
        const num = parseInt(octet, 10);
        return num >= 0 && num <= 255;
    });
}

module.exports = {
    isValidSteamId,
    isValidDiscordId,
    isValidGuid,
    isValidVerificationCode,
    sanitizeInput,
    isValidIp
};
