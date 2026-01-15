// setup.js - Script de configuração automatizada
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║     🎮  SETUP AUTOMÁTICO - Sistema DayZ Discord           ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝

Este assistente irá te guiar pela configuração inicial.
Pressione CTRL+C a qualquer momento para cancelar.
`);

const config = {};

function question(prompt) {
    return new Promise((resolve) => {
        rl.question(prompt, (answer) => {
            resolve(answer);
        });
    });
}

async function setup() {
    try {
        console.log('📋 PARTE 1: Configuração do Discord\n');
        
        config.DISCORD_TOKEN = await question('Token do Bot Discord: ');
        config.CLIENT_ID = await question('Client ID do Bot: ');
        config.GUILD_ID = await question('ID do Servidor Discord: ');
        
        console.log('\n✅ Discord configurado!\n');
        
        console.log('🗄️ PARTE 2: Configuração do MongoDB\n');
        
        const mongoDefault = 'mongodb://localhost:27017';
        config.MONGO_URL = await question(`URL do MongoDB [${mongoDefault}]: `) || mongoDefault;
        
        const dbDefault = 'dayz_server';
        config.DATABASE_NAME = await question(`Nome do Banco [${dbDefault}]: `) || dbDefault;
        
        console.log('\n✅ MongoDB configurado!\n');
        
        console.log('🎮 PARTE 3: Configuração do Servidor DayZ\n');
        
        config.SERVER_IP = await question('IP:Porta do servidor (ex: 192.168.1.100:2302): ');
        config.API_URL = await question('URL da API Universal (ex: https://192.168.1.100:443): ');
        
        console.log('\n✅ Servidor DayZ configurado!\n');
        
        console.log('🔔 PARTE 4: Webhooks do Discord (OPCIONAL)\n');
        console.log('Deixe em branco para pular\n');
        
        config.WEBHOOK_KILLS = await question('Webhook para Kill Feed: ');
        config.WEBHOOK_LOGS = await question('Webhook para Logs: ');
        config.WEBHOOK_ADMIN = await question('Webhook para Admin: ');
        
        console.log('\n✅ Webhooks configurados!\n');
        
        console.log('📁 PARTE 5: Canais do Discord\n');
        console.log('Para obter IDs: Discord → Configurações → Avançado → Modo Desenvolvedor\n');
        console.log('Clique direito no canal → Copiar ID\n');
        
        config.CHANNEL_LOGS = await question('ID do canal #logs: ');
        config.CHANNEL_KILLS = await question('ID do canal #kill-feed: ');
        config.CHANNEL_WELCOME = await question('ID do canal #bem-vindo: ');
        config.CHANNEL_VERIFICACAO = await question('ID do canal #verificação: ');
        
        console.log('\n✅ Canais configurados!\n');
        
        console.log('👥 PARTE 6: Cargos do Discord\n');
        console.log('Clique direito no cargo → Copiar ID\n');
        
        config.ROLE_VERIFIED = await question('ID do cargo Verificado: ');
        config.ROLE_VIP = await question('ID do cargo VIP: ');
        config.ROLE_ADMIN = await question('ID do cargo Admin: ');
        config.ROLE_MODERATOR = await question('ID do cargo Moderador: ');
        
        console.log('\n✅ Cargos configurados!\n');
        
        // Gerar arquivo .env
        const envContent = `# ==================== DISCORD ====================
DISCORD_TOKEN=${config.DISCORD_TOKEN}
CLIENT_ID=${config.CLIENT_ID}
GUILD_ID=${config.GUILD_ID}

# ==================== MONGODB ====================
MONGO_URL=${config.MONGO_URL}
DATABASE_NAME=${config.DATABASE_NAME}
COLLECTION_NAME=players

# ==================== DAYZ SERVER ====================
SERVER_IP=${config.SERVER_IP}
API_URL=${config.API_URL}

# ==================== API SERVER ====================
API_PORT=3000

# ==================== ROLES ====================
ROLE_VERIFIED=${config.ROLE_VERIFIED}
ROLE_VIP=${config.ROLE_VIP}
ROLE_ADMIN=${config.ROLE_ADMIN}
ROLE_MODERATOR=${config.ROLE_MODERATOR}

# ==================== CHANNELS ====================
CHANNEL_LOGS=${config.CHANNEL_LOGS}
CHANNEL_KILLS=${config.CHANNEL_KILLS}
CHANNEL_WELCOME=${config.CHANNEL_WELCOME}
CHANNEL_VERIFICACAO=${config.CHANNEL_VERIFICACAO}

# ==================== WEBHOOKS ====================
WEBHOOK_KILLS=${config.WEBHOOK_KILLS || ''}
WEBHOOK_LOGS=${config.WEBHOOK_LOGS || ''}
WEBHOOK_ADMIN=${config.WEBHOOK_ADMIN || ''}

# ==================== CAMINHOS ====================
DAYZ_LOG_PATH=C:/DayZServer/profiles/logs
SCRIPT_LOG_PATH=C:/DayZServer/profiles/UniversalApi/logs
`;

        fs.writeFileSync('.env', envContent);
        
        console.log('✅ Arquivo .env criado com sucesso!\n');
        
        // Criar estrutura de pastas
        console.log('📁 Criando estrutura de pastas...\n');
        
        const folders = ['public', 'logs', 'backups'];
        folders.forEach(folder => {
            if (!fs.existsSync(folder)) {
                fs.mkdirSync(folder);
                console.log(`  ✓ Pasta ${folder}/ criada`);
            }
        });
        
        // Mover dashboard para pasta public
        if (fs.existsSync('dashboard.html')) {
            fs.renameSync('dashboard.html', 'public/dashboard.html');
            console.log('  ✓ Dashboard movido para public/\n');
        }
        
        console.log('╔════════════════════════════════════════════════════════════╗');
        console.log('║                                                            ║');
        console.log('║              ✅  SETUP CONCLUÍDO COM SUCESSO!              ║');
        console.log('║                                                            ║');
        console.log('╚════════════════════════════════════════════════════════════╝\n');
        
        console.log('📝 PRÓXIMOS PASSOS:\n');
        console.log('  1️⃣  Instalar dependências:');
        console.log('      npm install\n');
        console.log('  2️⃣  Iniciar todos os serviços:');
        console.log('      npm run all\n');
        console.log('     OU iniciar individualmente:\n');
        console.log('      npm start        (Bot Discord)');
        console.log('      npm run monitor  (Monitor de Logs)');
        console.log('      npm run api      (API + Dashboard)\n');
        console.log('  3️⃣  Acessar o Dashboard:');
        console.log('      http://localhost:3000\n');
        console.log('  4️⃣  Scripts de manutenção:');
        console.log('      npm run maintenance\n');
        
        console.log('📚 DOCUMENTAÇÃO COMPLETA:');
        console.log('   Verifique o arquivo GUIA_COMPLETO.md\n');
        
        console.log('🆘 PRECISA DE AJUDA?');
        console.log('   Discord: https://discord.gg/zwxkCazPrk\n');
        
    } catch (error) {
        console.error('\n❌ Erro durante o setup:', error);
    } finally {
        rl.close();
    }
}

// Verificar se já existe .env
if (fs.existsSync('.env')) {
    console.log('⚠️  ATENÇÃO: Já existe um arquivo .env!\n');
    rl.question('Deseja sobrescrever? (s/N): ', (answer) => {
        if (answer.toLowerCase() === 's' || answer.toLowerCase() === 'sim') {
            setup();
        } else {
            console.log('\n❌ Setup cancelado. Arquivo .env existente mantido.\n');
            rl.close();
        }
    });
} else {
    setup();
}