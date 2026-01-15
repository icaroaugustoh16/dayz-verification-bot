# 🎮 DayZ Discord Automation Bot

<div align="center">

![Version](https://img.shields.io/badge/version-2.0.0-blue.svg)
![Node.js](https://img.shields.io/badge/node.js-18.x+-green.svg)
![Discord.js](https://img.shields.io/badge/discord.js-14.x-7289da.svg)
![MongoDB](https://img.shields.io/badge/mongodb-6.x-47A248.svg)
![License](https://img.shields.io/badge/license-MIT-yellow.svg)

**Sistema completo de automação para servidores DayZ com integração Discord**

[Instalação](#-instalação) • [Configuração](#-configuração) • [Funcionalidades](#-funcionalidades) • [Comandos](#-comandos-slash) • [API](#-api-rest)

</div>

---

## 📋 Descrição

O **DayZ Discord Automation Bot** é uma solução completa para gerenciamento de servidores DayZ, oferecendo:

- 🔐 **Verificação Steam** - Vinculação de contas Steam com Discord
- 💰 **Sistema de Coins** - Economia in-game com pagamentos via PIX (Mercado Pago)
- 📊 **Leaderboard** - Ranking de jogadores sincronizado em tempo real
- 📜 **Monitoramento de Logs** - Análise de BattlEye logs e eventos do servidor
- 🎫 **Whitelist Automática** - Gestão automatizada de acesso ao servidor
- 🛡️ **Painel Admin** - Dashboard completo para administração

---

## 🚀 Funcionalidades

### 🔐 Sistema de Verificação
- Autenticação via Steam OpenID
- Vinculação automática Discord ↔ Steam
- Atribuição automática de cargos verificados
- Suporte a múltiplas contas Steam por usuário

### 💰 Sistema de Coins & Pagamentos
- Integração nativa com **Mercado Pago** (PIX)
- Pacotes de coins configuráveis com bônus
- Webhooks para confirmação automática de pagamentos
- Histórico completo de transações
- Sistema de reembolso para administradores

### 📊 Estatísticas & Rankings
- Sincronização com mod LeaderBoard do DayZ
- Rankings por: Kills, Deaths, K/D, Tempo jogado, Zombie kills
- Estatísticas individuais de jogadores
- Atualização em tempo real

### 📜 Monitoramento de Logs
- Parsing de logs BattlEye em tempo real
- Detecção de eventos: conexões, desconexões, kicks, bans
- Webhooks para Discord com eventos formatados
- Histórico de sessões de jogadores

### 🛡️ Administração
- Comandos de admin para gestão de jogadores
- Sistema de desvincular/liberar contas
- Gerenciamento de pagamentos e reembolsos
- Dashboard via API REST

---

## 📦 Pré-requisitos

- **Node.js** 18.x ou superior
- **MongoDB** 6.x ou superior
- **Servidor DayZ** com mod LeaderBoard (opcional)
- **Bot Discord** criado no [Discord Developer Portal](https://discord.com/developers/applications)
- **Conta Mercado Pago** com Access Token (para sistema de coins)
- **Steam API Key** obtida em [Steam Web API](https://steamcommunity.com/dev/apikey)

---

## ⚡ Instalação

### 1. Clone o repositório

```bash
git clone https://github.com/seu-usuario/dayz-verification-bot.git
cd dayz-verification-bot
```

### 2. Instale as dependências

```bash
npm install
```

### 3. Configure as variáveis de ambiente

Crie um arquivo `.env` na raiz do projeto (ou use o setup automatizado):

```bash
npm run setup
```

Ou configure manualmente:

```env
# ========== DISCORD ==========
DISCORD_TOKEN=seu_token_do_bot
CLIENT_ID=id_do_bot
GUILD_ID=id_do_servidor

# ========== MONGODB ==========
MONGO_URL=mongodb://localhost:27017
DATABASE_NAME=dayz_server

# ========== STEAM ==========
STEAM_API_KEY=sua_api_key_steam
STEAM_REALM=http://seu-dominio.com:3002
STEAM_RETURN_URL=http://seu-dominio.com:3002/auth/steam/return

# ========== MERCADO PAGO ==========
MERCADOPAGO_ACCESS_TOKEN=seu_access_token
WEBHOOK_URL=https://seu-dominio.com

# ========== SERVIDOR DAYZ ==========
SERVER_IP=192.168.1.100:2302
BE_LOG_DIR=C:/DayZServer/Bec/Log/config/BeLog
CHAT_LOG_DIR=C:/DayZServer/Bec/Log/config/Chat
LEADERBOARD_PATH=C:/DayZServer/Profiles/_LeaderBoard
WHITELIST_PATH=C:/DayZServer/whitelist.txt

# ========== PORTAS ==========
API_PORT=3000
VERIFICATION_PORT=3002

# ========== CARGOS DISCORD ==========
ROLE_VERIFIED=id_do_cargo_verificado

# ========== WEBHOOKS (OPCIONAL) ==========
WEBHOOK_KILLS=url_webhook_killfeed
WEBHOOK_LOGS=url_webhook_logs
WEBHOOK_ADMIN=url_webhook_admin
```

### 4. Registre os comandos slash

```bash
npm run deploy
```

### 5. Inicie o sistema

```bash
# Iniciar todos os serviços
npm run all

# Ou iniciar individualmente:
npm start          # Bot principal
npm run api        # Servidor API
npm run verify     # Servidor de verificação Steam
npm run monitor    # Monitor de logs BattlEye
npm run leaderboard # Sincronização de leaderboard
```

---

## 🎮 Comandos Slash

### 👤 Comandos de Usuário

| Comando | Descrição |
|---------|-----------|
| `/player` | Ver suas estatísticas no servidor |
| `/ranking <tipo>` | Ver rankings (kills, playtime, money, kdratio, zombiekills) |
| `/minhascontas` | Ver suas contas Steam vinculadas |
| `/meus-pagamentos` | Ver histórico de pagamentos |
| `/coins-saldo` | Ver saldo de coins |

### 🛡️ Comandos de Administração

| Comando | Descrição |
|---------|-----------|
| `/admin-player <steam_id>` | Ver informações detalhadas de um jogador |
| `/admin-desvincular <discord_id>` | Desvincular conta de um usuário |
| `/admin-liberar <steam_id>` | Liberar Steam ID para nova verificação |
| `/admin-pagamentos <discord_id>` | Ver pagamentos de um usuário |
| `/admin-reembolso <pagamento_id>` | Processar reembolso |
| `/admin-status` | Status geral do sistema |
| `/coins-add <usuario> <quantidade>` | Adicionar coins a um usuário |
| `/setup-loja` | Configurar loja de coins |
| `/setup-painel` | Configurar painel de verificação |

---

## 🌐 API REST

O servidor API roda por padrão na porta `3000`.

### Endpoints Principais

```
GET  /                         → Status da API
GET  /api/players              → Lista de jogadores
GET  /api/players/:steamId     → Dados de um jogador
GET  /api/stats                → Estatísticas gerais
GET  /api/leaderboard          → Rankings do servidor
POST /webhook/mercadopago      → Webhook do Mercado Pago
```

### Servidor de Verificação (porta 3002)

```
GET  /                         → Status do serviço
GET  /verify                   → Página de verificação Steam
GET  /auth/steam               → Iniciar autenticação Steam
GET  /auth/steam/return        → Callback Steam OpenID
POST /api/security/register    → Registro via launcher
GET  /api/player/:steamId      → Dados de segurança do jogador
```

---

## 📁 Estrutura do Projeto

```
dayz-verification-bot/
├── bot.js                    # Bot Discord principal (legado)
├── bot-new.js                # Bot Discord v2 (atual)
├── server.js                 # Servidor API REST
├── verification-server.js    # Servidor de verificação Steam
├── be-log-monitor.js         # Monitor de logs BattlEye
├── leaderboard-sync.js       # Sincronização de rankings
├── deploy-commands.js        # Deploy de slash commands
├── setup.js                  # Assistente de configuração
├── mercadopago-webhook.js    # Handler de webhooks MP
├── maintenance.js            # Tarefas de manutenção
├── migrate-players.js        # Migração de dados
│
├── commands/                 # Comandos slash do bot
│   ├── admin-*.js            # Comandos administrativos
│   ├── coins-*.js            # Sistema de coins
│   ├── player.js             # Estatísticas do jogador
│   ├── ranking.js            # Rankings
│   └── setup-*.js            # Comandos de setup
│
├── config/                   # Arquivos de configuração
│   ├── coin-packages.json    # Pacotes de coins
│   └── terms-of-service.json # Termos de serviço
│
├── models/                   # Modelos de dados
│   └── Player.js             # Modelo de jogador
│
├── utils/                    # Utilitários
│   ├── be-parser.js          # Parser de logs BattlEye
│   ├── coins.js              # Funções de coins
│   ├── database.js           # Conexão MongoDB
│   ├── errorHandler.js       # Handler de erros
│   ├── mercadopago.js        # Integração Mercado Pago
│   ├── validation.js         # Validações
│   └── whitelist.js          # Gestão de whitelist
│
└── public/                   # Arquivos estáticos (dashboard)
```

---

## 🔧 Scripts Disponíveis

| Script | Comando | Descrição |
|--------|---------|-----------|
| `start` | `npm start` | Inicia o bot principal |
| `dev` | `npm run dev` | Modo desenvolvimento (nodemon) |
| `deploy` | `npm run deploy` | Registra slash commands |
| `api` | `npm run api` | Inicia servidor API |
| `verify` | `npm run verify` | Inicia servidor de verificação |
| `monitor` | `npm run monitor` | Inicia monitor de logs |
| `leaderboard` | `npm run leaderboard` | Sincroniza leaderboard |
| `maintenance` | `npm run maintenance` | Executa manutenção |
| `all` | `npm run all` | Inicia todos os serviços |
| `setup` | `npm run setup` | Assistente de configuração |

---

## 🔒 Segurança

- **Rate Limiting**: Proteção contra spam em todas as rotas da API
- **Validação de Webhooks**: Verificação de origem para Mercado Pago
- **Índices únicos**: Prevenção de duplicação no MongoDB
- **Sessões seguras**: Cookies seguros para autenticação Steam

---

## 📝 Configuração de Pacotes de Coins

Edite o arquivo `config/coin-packages.json`:

```json
[
  {
    "id": "pack1",
    "name": "Pacote Iniciante",
    "coins": 1000,
    "bonus": 0,
    "price": 10.00,
    "emoji": "💰"
  },
  {
    "id": "pack2",
    "name": "Pacote Médio",
    "coins": 5000,
    "bonus": 500,
    "price": 45.00,
    "emoji": "💎"
  }
]
```

---

## 🤝 Contribuindo

1. Faça um Fork do projeto
2. Crie uma branch para sua feature (`git checkout -b feature/NovaFeature`)
3. Commit suas mudanças (`git commit -m 'Add: Nova feature'`)
4. Push para a branch (`git push origin feature/NovaFeature`)
5. Abra um Pull Request

---

## 📄 Licença

Este projeto está sob a licença MIT. Veja o arquivo [LICENSE](LICENSE) para mais detalhes.

---

## 💬 Suporte

- **Issues**: [GitHub Issues](https://github.com/seu-usuario/dayz-verification-bot/issues)
- **Discord**: Entre em contato pelo servidor Discord do projeto

---

<div align="center">

Desenvolvido com ❤️ para a comunidade DayZ

</div>
