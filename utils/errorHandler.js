let db = null;

/**
 * Inicializa o handler de erros com conexão MongoDB
 * @param {object} database - Instância do MongoDB
 */
function initErrorHandler(database) {
    db = database;
}

/**
 * Handler centralizado de erros
 * @param {string} context - Contexto onde o erro ocorreu
 * @param {Error} error - Objeto de erro
 * @param {string|null} userMessage - Mensagem amigável para o usuário
 * @returns {string} - Mensagem de erro para exibir ao usuário
 */
async function handleError(context, error, userMessage = null) {
    const timestamp = new Date();
    const errorLog = {
        context,
        message: error.message,
        stack: error.stack,
        name: error.name,
        code: error.code,
        timestamp
    };

    // Log no console
    console.error(`[ERROR] ${context}:`, error.message);
    console.error('Stack:', error.stack);

    // Salvar no MongoDB para análise posterior
    if (db) {
        try {
            await db.collection('error_logs').insertOne(errorLog);
        } catch (dbError) {
            console.error('[ERROR] Falha ao salvar erro no MongoDB:', dbError.message);
        }
    }

    // Retornar mensagem apropriada para o usuário
    if (userMessage) {
        return userMessage;
    }

    // Mensagens baseadas no tipo de erro
    switch (error.name) {
        case 'MongoError':
        case 'MongoServerError':
            return '❌ Erro de banco de dados. Tente novamente em instantes.';

        case 'ValidationError':
            return `❌ Dados inválidos: ${error.message}`;

        case 'TypeError':
            return '❌ Erro interno do sistema. Contate um administrador.';

        default:
            if (error.code === 'ENOENT') {
                return '❌ Arquivo não encontrado. Contate um administrador.';
            } else if (error.code === 'EACCES') {
                return '❌ Permissão negada. Contate um administrador.';
            } else if (error.code === 'ETIMEDOUT') {
                return '❌ Conexão expirou. Tente novamente.';
            }

            return '❌ Erro inesperado. Contate um administrador.';
    }
}

/**
 * Handler simplificado para erros em comandos Discord
 * @param {object} message - Mensagem do Discord
 * @param {string} command - Nome do comando
 * @param {Error} error - Objeto de erro
 */
async function handleCommandError(message, command, error) {
    const userMessage = await handleError(`Discord Command: ${command}`, error);

    try {
        await message.reply(userMessage);
    } catch (replyError) {
        console.error('[ERROR] Falha ao enviar mensagem de erro:', replyError.message);
    }
}

/**
 * Handler para erros em endpoints da API
 * @param {object} res - Response do Express
 * @param {string} endpoint - Nome do endpoint
 * @param {Error} error - Objeto de erro
 */
async function handleApiError(res, endpoint, error) {
    await handleError(`API Endpoint: ${endpoint}`, error);

    // Resposta HTTP apropriada
    const statusCode = error.statusCode || 500;
    const response = {
        error: true,
        message: error.message || 'Erro interno do servidor'
    };

    res.status(statusCode).json(response);
}

/**
 * Busca logs de erro recentes
 * @param {number} limit - Número máximo de logs
 * @returns {Array} - Array de logs de erro
 */
async function getRecentErrors(limit = 20) {
    if (!db) {
        return [];
    }

    try {
        return await db.collection('error_logs')
            .find({})
            .sort({ timestamp: -1 })
            .limit(limit)
            .toArray();
    } catch (error) {
        console.error('[ERROR] Falha ao buscar logs:', error.message);
        return [];
    }
}

/**
 * Limpa logs de erro antigos
 * @param {number} days - Manter apenas logs dos últimos N dias
 * @returns {number} - Número de logs removidos
 */
async function cleanOldErrorLogs(days = 30) {
    if (!db) {
        return 0;
    }

    try {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);

        const result = await db.collection('error_logs').deleteMany({
            timestamp: { $lt: cutoffDate }
        });

        console.log(`[ERROR HANDLER] ${result.deletedCount} logs antigos removidos`);
        return result.deletedCount;
    } catch (error) {
        console.error('[ERROR] Falha ao limpar logs:', error.message);
        return 0;
    }
}

module.exports = {
    initErrorHandler,
    handleError,
    handleCommandError,
    handleApiError,
    getRecentErrors,
    cleanOldErrorLogs
};
