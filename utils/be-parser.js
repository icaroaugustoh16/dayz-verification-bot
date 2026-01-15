// ================================================
// BATTLEYE LOG PARSER - Extrai GUID e IP dos logs
// ================================================
const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
require('dotenv').config();

const BE_LOG_DIR = process.env.BE_LOG_DIR || 'C:\\DayZServer1.28_TESTE\\DayZServerModded_TESTE\\Bec\\Log\\config\\BeLog';

// Cache de GUIDs e IPs por nome de jogador
const playerCache = new Map();

// ========== PARSEAR LINHA DO LOG ==========
function parseBeLogLine(line) {
    // Extrair timestamp do início da linha: ﻿16:38:40 : Player...
    const timestampMatch = line.match(/^[\ufeff]?(\d{2}):(\d{2}):(\d{2})\s*:/);
    let timestamp = null;
    if (timestampMatch) {
        const now = new Date();
        const hours = parseInt(timestampMatch[1]);
        const minutes = parseInt(timestampMatch[2]);
        const seconds = parseInt(timestampMatch[3]);
        timestamp = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, seconds);
    }
    
    // Regex para conectar: Player #0 [ADMIN]HunterH06 (170.82.50.195:11789) connected
    const connectMatch = line.match(/Player #(\d+) (.+?) \((\d+\.\d+\.\d+\.\d+):\d+\) connected/);
    
    // Regex para GUID: Player #0 [ADMIN]HunterH06 - BE GUID: 1bcbd6bce6431a3d3a4d51cac4795f9d
    const guidMatch = line.match(/Player #(\d+) (.+?) - BE GUID: ([a-f0-9]+)/);
    
    // Regex para disconnect: Player #0 [ADMIN]HunterH06 disconnected
    const disconnectMatch = line.match(/Player #(\d+) (.+?) disconnected/);
    
    return {
        timestamp,
        connect: connectMatch ? {
            playerId: connectMatch[1],
            playerName: connectMatch[2],
            ipAddress: connectMatch[3]
        } : null,
        
        guid: guidMatch ? {
            playerId: guidMatch[1],
            playerName: guidMatch[2],
            guid: guidMatch[3]
        } : null,
        
        disconnect: disconnectMatch ? {
            playerId: disconnectMatch[1],
            playerName: disconnectMatch[2]
        } : null
    };
}

// ========== OBTER GUID DE UM JOGADOR ==========
function getPlayerGuid(playerName) {
    const cached = playerCache.get(playerName);
    if (cached && cached.guid) {
        return cached.guid;
    }
    return null;
}

// ========== OBTER IP DE UM JOGADOR ==========
function getPlayerIp(playerName) {
    const cached = playerCache.get(playerName);
    if (cached && cached.ip) {
        return cached.ip;
    }
    return null;
}

// ========== OBTER TEMPO DE CONEXÃO DE UM JOGADOR ==========
function getPlayerConnectTime(playerName) {
    const cached = playerCache.get(playerName);
    if (cached && cached.connectTime) {
        return cached.connectTime;
    }
    return null;
}

// ========== CALCULAR TEMPO DE SESSÃO ==========
function calculateSessionTime(playerName, disconnectTime) {
    const connectTime = getPlayerConnectTime(playerName);
    if (connectTime && disconnectTime) {
        const diffMs = disconnectTime - connectTime;
        const diffMinutes = Math.floor(diffMs / 60000); // Converter ms para minutos
        return diffMinutes;
    }
    return 0;
}

// ========== PROCESSAR ARQUIVO DE LOG ==========
function processBeLog(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n');
        
        for (const line of lines) {
            const parsed = parseBeLogLine(line);
            
            // Armazenar IP e timestamp quando jogador conecta
            if (parsed.connect) {
                const { playerName, ipAddress } = parsed.connect;
                if (!playerCache.has(playerName)) {
                    playerCache.set(playerName, {});
                }
                playerCache.get(playerName).ip = ipAddress;
                playerCache.get(playerName).connectTime = parsed.timestamp || new Date();
            }
            
            // Armazenar GUID quando verificado
            if (parsed.guid) {
                const { playerName, guid } = parsed.guid;
                if (!playerCache.has(playerName)) {
                    playerCache.set(playerName, {});
                }
                playerCache.get(playerName).guid = guid;
            }
            
            // Armazenar timestamp de disconnect
            if (parsed.disconnect) {
                const { playerName } = parsed.disconnect;
                if (playerCache.has(playerName)) {
                    playerCache.get(playerName).disconnectTime = parsed.timestamp || new Date();
                }
                
                // Limpar cache após 5 minutos
                setTimeout(() => {
                    playerCache.delete(playerName);
                }, 5 * 60 * 1000);
            }
        }
    } catch (error) {
        console.error('❌ Erro ao processar BE log:', error.message);
    }
}

// ========== MONITORAR LOGS DO BATTLEYE ==========
function startBeLogMonitor() {
    if (!fs.existsSync(BE_LOG_DIR)) {
        console.warn(`⚠️ Pasta de logs BattlEye não encontrada: ${BE_LOG_DIR}`);
        return;
    }
    
    // Processar logs existentes
    const logFiles = fs.readdirSync(BE_LOG_DIR).filter(f => f.endsWith('.log'));
    
    if (logFiles.length === 0) {
        console.warn('⚠️ Nenhum arquivo .log encontrado em BattlEye');
        return;
    }
    
    // Processar o log mais recente
    const latestLog = logFiles.sort().reverse()[0];
    const latestLogPath = path.join(BE_LOG_DIR, latestLog);
    processBeLog(latestLogPath);
    
    // Monitorar mudanças no log mais recente
    const watcher = chokidar.watch(latestLogPath, {
        persistent: true,
        awaitWriteFinish: {
            stabilityThreshold: 100,
            pollInterval: 50
        }
    });
    
    watcher.on('change', (filePath) => {
        processBeLog(filePath);
    });
    
    console.log(`✅ BattlEye Monitor: Monitorando ${latestLog}`);
}

module.exports = {
    startBeLogMonitor,
    getPlayerGuid,
    getPlayerIp,
    getPlayerConnectTime,
    calculateSessionTime,
    playerCache
};
