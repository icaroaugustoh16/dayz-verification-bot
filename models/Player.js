// models/Player.js - Helper para gerenciar Players no MongoDB

/**
 * Estrutura do Player no MongoDB:
 *
 * {
 *   // Identificação
 *   primarySteamId: String (required, unique, indexed)
 *   steamIds: [String]
 *
 *   // Discord
 *   discordId: String
 *   discordTag: String (antes discordUsername)
 *
 *   // Status
 *   verified: Boolean (verificado no Discord)
 *   launcherVerified: Boolean (verificado no launcher)
 *   canPlay: Boolean
 *
 *   // Hardware - Fingerprint anti-colisão
 *   hardwareId: String (required, indexed)
 *
 *   // Hardware detalhado
 *   hardware: {
 *     cpuId: String
 *     motherboardSerial: String
 *     biosSerial: String
 *     windowsProductId: String
 *     machineGuid: String
 *     windowsInstallDate: String
 *     diskSerials: [String]
 *     macAddresses: [String]
 *     ramSerialNumbers: [String]
 *     networkAdapterIds: [String]
 *     gpuId: String
 *   }
 *
 *   // Informações do sistema
 *   machineName: String
 *   osVersion: String
 *   ipAddress: String
 *   launcherVersion: String
 *
 *   // Histórico
 *   ipHistory: [{ ip: String, timestamp: Date }]
 *   hardwareHistory: [{ hardwareId: String, timestamp: Date }]
 *
 *   // Timestamps
 *   firstSeen: Date
 *   lastSeen: Date
 *   createdAt: Date
 *   updatedAt: Date
 * }
 */

class PlayerModel {
    constructor(db) {
        this.db = db;
        this.collection = db.collection('players');
    }

    /**
     * Buscar player por Steam ID (compatível com estrutura existente)
     */
    async findBySteamId(steamId) {
        return await this.collection.findOne({
            $or: [
                { steamId: steamId },           // Campo principal
                { knownSteamIds: steamId },     // Steam IDs alternativos
                { primarySteamId: steamId }     // Compatibilidade se existir
            ]
        });
    }

    /**
     * Alias para compatibilidade
     */
    async findByPrimarySteamId(steamId) {
        return await this.findBySteamId(steamId);
    }

    /**
     * Buscar player por Discord ID
     */
    async findByDiscordId(discordId) {
        return await this.collection.findOne({ discordId });
    }

    /**
     * Criar novo player (compatível com estrutura existente)
     */
    async create(playerData) {
        const now = new Date();

        const newPlayer = {
            // Identificação (mantém estrutura existente)
            steamId: playerData.primarySteamId,
            knownSteamIds: playerData.steamIds || [playerData.primarySteamId],

            // Discord
            discordId: playerData.discordId || null,
            discordTag: playerData.discordTag || null,

            // Status
            verified: playerData.verified || false,
            launcherVerified: playerData.launcherVerified || false,

            // Hardware (estrutura plana - compatível com existente)
            hardwareId: playerData.hardwareId || '',
            cpuId: playerData.cpuId || '',
            motherboardSerial: playerData.motherboardSerial || '',
            biosSerial: playerData.biosSerial || '',
            windowsProductId: playerData.windowsProductId || '',
            diskSerials: playerData.diskSerials || [],
            macAddresses: playerData.macAddresses || [],
            ramSerialNumbers: playerData.ramSerialNumbers || [],
            networkAdapterIds: playerData.networkAdapterIds || [],
            gpuId: playerData.gpuId || '',

            // Informações do sistema
            machineName: playerData.machineName || '',
            osVersion: playerData.osVersion || '',
            lastIp: playerData.ipAddress || '',
            lastLauncherVersion: playerData.launcherVersion || '',
            lastLauncherCheck: now,

            // Timestamps
            firstJoin: now,
            lastLogin: now,

            // Compatibilidade com sistema existente
            guid: 'pending',
            guidSource: null,
            name: null,
            steamName: playerData.steamName || null,
            kills: 0,
            deaths: 0,
            zombieKills: 0,
            longestKill: 0,
            kdRatio: 0,
            playTime: 0,
            online: false,
            money: 10000,
            clanId: null,
            awaitingGuid: false
        };

        const result = await this.collection.insertOne(newPlayer);
        return { ...newPlayer, _id: result.insertedId };
    }

    /**
     * Atualizar hardware (estrutura plana compatível)
     */
    async updateHardware(steamId, newHardwareId, hardwareData) {
        const player = await this.findBySteamId(steamId);

        if (!player) {
            throw new Error('Player não encontrado');
        }

        const updates = {
            $set: {
                hardwareId: newHardwareId,
                cpuId: hardwareData.cpuId || '',
                motherboardSerial: hardwareData.motherboardSerial || '',
                biosSerial: hardwareData.biosSerial || '',
                windowsProductId: hardwareData.windowsProductId || '',
                diskSerials: hardwareData.diskSerials || [],
                macAddresses: hardwareData.macAddresses || [],
                ramSerialNumbers: hardwareData.ramSerialNumbers || [],
                networkAdapterIds: hardwareData.networkAdapterIds || [],
                gpuId: hardwareData.gpuId || '',
                lastLauncherCheck: new Date()
            }
        };

        await this.collection.updateOne(
            { steamId },
            updates
        );
    }

    /**
     * Atualizar IP
     */
    async updateIP(steamId, newIP) {
        const player = await this.findBySteamId(steamId);

        if (!player) {
            throw new Error('Player não encontrado');
        }

        const updates = {
            $set: {
                lastIp: newIP,
                lastLauncherCheck: new Date()
            }
        };

        await this.collection.updateOne(
            { steamId },
            updates
        );
    }

    /**
     * Atualizar dados do player (genérico)
     */
    async update(steamId, updateData) {
        const updates = {
            $set: {
                ...updateData,
                lastLauncherCheck: new Date()
            }
        };

        await this.collection.updateOne(
            { steamId },
            updates
        );
    }

    /**
     * Adicionar Steam ID alternativo ao knownSteamIds
     */
    async addSteamId(steamId, newSteamId) {
        await this.collection.updateOne(
            { steamId },
            {
                $addToSet: { knownSteamIds: newSteamId },
                $set: {
                    lastLauncherCheck: new Date()
                }
            }
        );
    }

    /**
     * Criar índices necessários (compatível com estrutura existente)
     */
    async createIndexes() {
        // Índices principais para busca
        await this.collection.createIndex({ steamId: 1 });
        await this.collection.createIndex({ knownSteamIds: 1 });
        await this.collection.createIndex({ hardwareId: 1 });
        await this.collection.createIndex({ discordId: 1 });

        console.log('✅ [PLAYER MODEL] Índices criados');
    }
}

module.exports = PlayerModel;
