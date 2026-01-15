const { MercadoPagoConfig, Payment, Preference } = require('mercadopago');

// Inicializar SDK com Access Token (versão 2.x)
const client = new MercadoPagoConfig({ 
    accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN 
});
const payment = new Payment(client);
const preference = new Preference(client);

/**
 * Cria um pagamento PIX no Mercado Pago
 * @param {Object} paymentData - Dados do pagamento
 * @returns {Object} - Resposta do Mercado Pago com QR Code
 */
async function createPixPayment(paymentData) {
    try {
        // Validar WEBHOOK_URL antes de criar pagamento
        const webhookUrl = process.env.WEBHOOK_URL;
        if (!webhookUrl) {
            throw new Error('WEBHOOK_URL não configurada no .env');
        }
        if (webhookUrl.includes('localhost') || webhookUrl.includes('127.0.0.1')) {
            throw new Error('WEBHOOK_URL não pode ser localhost! Use ngrok ou um domínio público.');
        }
        if (!webhookUrl.startsWith('https://') && !webhookUrl.startsWith('http://')) {
            throw new Error('WEBHOOK_URL deve começar com http:// ou https://');
        }

        const { amount, description, email, metadata } = paymentData;

        const body = {
            transaction_amount: parseFloat(amount),
            description: description,
            payment_method_id: 'pix',
            payer: {
                email: email,
                first_name: metadata.playerName || 'Player',
                last_name: 'DayZ'
            },
            notification_url: `${process.env.WEBHOOK_URL}/webhook/mercadopago/webhook`,
            metadata: {
                discord_id: metadata.discordId,
                steam_id: metadata.steamId,
                package_id: metadata.packageId,
                coins: metadata.coins,
                bonus: metadata.bonus
            },
            date_of_expiration: getExpirationDate(30) // 30 minutos para pagar
        };

        console.log('💳 Criando pagamento PIX no Mercado Pago...');
        const response = await payment.create({ body });

        // Verificar se a resposta tem os dados necessários
        if (!response || !response.id) {
            console.error('❌ Resposta inválida do Mercado Pago:', response);
            throw new Error('Mercado Pago retornou resposta inválida. Verifique suas credenciais.');
        }

        // Verificar se o QR Code foi gerado
        if (!response.point_of_interaction?.transaction_data?.qr_code) {
            console.error('❌ QR Code não foi gerado na resposta:', response);
            throw new Error('QR Code PIX não foi gerado. Verifique se a chave PIX está configurada no Mercado Pago.');
        }

        const paymentInfo = {
            id: response.id,
            status: response.status,
            qr_code: response.point_of_interaction.transaction_data.qr_code,
            qr_code_base64: response.point_of_interaction.transaction_data.qr_code_base64,
            ticket_url: response.point_of_interaction.transaction_data.ticket_url,
            expiration_date: response.date_of_expiration
        };

        console.log(`✅ Pagamento criado: ID ${paymentInfo.id}`);
        return paymentInfo;

    } catch (error) {
        console.error('❌ Erro ao criar pagamento PIX:', error.message);
        if (error.response) {
            console.error('Detalhes:', JSON.stringify(error.response.data, null, 2));
        }
        throw error;
    }
}

/**
 * Consulta o status de um pagamento
 * @param {string} paymentId - ID do pagamento
 * @returns {Object} - Status do pagamento
 */
async function getPaymentStatus(paymentId) {
    try {
        const response = await payment.get({ id: paymentId });
        
        return {
            id: response.id,
            status: response.status,
            status_detail: response.status_detail,
            transaction_amount: response.transaction_amount,
            metadata: response.metadata,
            date_approved: response.date_approved,
            date_created: response.date_created
        };
    } catch (error) {
        console.error(`❌ Erro ao consultar pagamento ${paymentId}:`, error.message);
        throw error;
    }
}

/**
 * Verifica a autenticidade de uma notificação webhook
 * @param {Object} notification - Dados da notificação
 * @returns {boolean} - Se a notificação é válida
 */
function validateWebhook(notification) {
    // Mercado Pago envia notificações em dois formatos:
    // Novo: { topic: "payment", resource: "URL" }
    // Antigo: { type: "payment", data: { id: "123" } }
    
    const topic = notification.topic || notification.type;
    const hasResource = notification.resource || notification.data;
    
    if (!topic || !hasResource) {
        return false;
    }

    // Tipos válidos: payment, merchant_order
    const validTypes = ['payment', 'merchant_order'];
    return validTypes.includes(topic);
}

/**
 * Gera data de expiração
 * @param {number} minutes - Minutos até expirar
 * @returns {string} - Data ISO
 */
function getExpirationDate(minutes) {
    const date = new Date();
    date.setMinutes(date.getMinutes() + minutes);
    return date.toISOString();
}

/**
 * Formata valor monetário para BRL
 * @param {number} value - Valor numérico
 * @returns {string} - Valor formatado
 */
function formatCurrency(value) {
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL'
    }).format(value);
}

/**
 * Mapeia status do Mercado Pago para mensagens amigáveis
 * @param {string} status - Status do pagamento
 * @returns {Object} - Emoji e descrição
 */
function getStatusInfo(status) {
    const statusMap = {
        'pending': { emoji: '⏳', text: 'Aguardando Pagamento', color: '#FFA500' },
        'approved': { emoji: '✅', text: 'Pagamento Aprovado', color: '#00FF00' },
        'authorized': { emoji: '🔐', text: 'Pagamento Autorizado', color: '#00CED1' },
        'in_process': { emoji: '🔄', text: 'Em Processamento', color: '#1E90FF' },
        'in_mediation': { emoji: '⚖️', text: 'Em Mediação', color: '#FF8C00' },
        'rejected': { emoji: '❌', text: 'Pagamento Recusado', color: '#FF0000' },
        'cancelled': { emoji: '🚫', text: 'Pagamento Cancelado', color: '#8B0000' },
        'refunded': { emoji: '💸', text: 'Pagamento Reembolsado', color: '#4B0082' },
        'charged_back': { emoji: '↩️', text: 'Estornado', color: '#DC143C' }
    };

    return statusMap[status] || { emoji: '❓', text: 'Status Desconhecido', color: '#808080' };
}

/**
 * Cria uma preferência de pagamento para Cartão de Crédito (Checkout Pro)
 * @param {Object} paymentData - Dados do pagamento
 * @returns {Object} - Resposta do Mercado Pago com link de checkout
 */
async function createCreditCardPayment(paymentData) {
    try {
        // Validar WEBHOOK_URL antes de criar pagamento
        const webhookUrl = process.env.WEBHOOK_URL;
        if (!webhookUrl) {
            throw new Error('WEBHOOK_URL não configurada no .env');
        }
        if (webhookUrl.includes('localhost') || webhookUrl.includes('127.0.0.1')) {
            throw new Error('WEBHOOK_URL não pode ser localhost! Use ngrok ou um domínio público.');
        }
        if (!webhookUrl.startsWith('https://') && !webhookUrl.startsWith('http://')) {
            throw new Error('WEBHOOK_URL deve começar com http:// ou https://');
        }

        const { amount, description, email, metadata } = paymentData;

        const body = {
            items: [
                {
                    id: metadata.packageId,
                    title: description,
                    quantity: 1,
                    unit_price: parseFloat(amount),
                    currency_id: 'BRL'
                }
            ],
            payer: {
                email: email,
                name: metadata.playerName || 'Player',
                surname: 'DayZ'
            },
            back_urls: {
                success: `${process.env.WEBHOOK_URL}/payment/success`,
                failure: `${process.env.WEBHOOK_URL}/payment/failure`,
                pending: `${process.env.WEBHOOK_URL}/payment/pending`
            },
            auto_return: 'approved',
            notification_url: `${process.env.WEBHOOK_URL}/webhook/mercadopago/webhook`,
            metadata: {
                discord_id: metadata.discordId,
                steam_id: metadata.steamId,
                package_id: metadata.packageId,
                coins: metadata.coins,
                bonus: metadata.bonus
            },
            statement_descriptor: 'DayZ Apocalypse',
            external_reference: `${metadata.discordId}_${Date.now()}`,
            expires: true,
            expiration_date_from: new Date().toISOString(),
            expiration_date_to: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        };

        console.log('💳 Criando preferência de pagamento no Mercado Pago...');
        const response = await preference.create({ body });

        if (response) {
            // Usar sandbox_init_point SEMPRE em NODE_ENV=development
            // O Mercado Pago usa sandbox_init_point para credenciais de teste
            const isDevelopment = process.env.NODE_ENV === 'development';
            
            const preferenceInfo = {
                id: response.id,
                init_point: isDevelopment ? response.sandbox_init_point : response.init_point,
                sandbox_init_point: response.sandbox_init_point
            };

            console.log(`✅ Preferência criada: ID ${preferenceInfo.id}`);
            console.log(`🔧 Ambiente: ${isDevelopment ? 'TEST (Sandbox)' : 'PRODUCTION'}`);
            console.log(`🔗 URL de checkout: ${preferenceInfo.init_point}`);
            return preferenceInfo;
        }

        throw new Error('Resposta inválida do Mercado Pago');

    } catch (error) {
        console.error('❌ Erro ao criar preferência de pagamento:', error.message);
        if (error.response) {
            console.error('Detalhes:', JSON.stringify(error.response.data, null, 2));
        }
        throw error;
    }
}

module.exports = {
    createPixPayment,
    createCreditCardPayment,
    getPaymentStatus,
    validateWebhook,
    formatCurrency,
    getStatusInfo
};
