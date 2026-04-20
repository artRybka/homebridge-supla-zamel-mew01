"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.SuplaMew01Platform = void 0;
const fs_1 = require("fs");
const path = __importStar(require("path"));
const accessory_1 = require("./accessory");
const eveCharacteristics_1 = require("./eveCharacteristics");
const settings_1 = require("./settings");
const suplaClient_1 = require("./suplaClient");
const TOKEN_CACHE_FILE = 'supla-mew01-tokens.json';
class SuplaMew01Platform {
    log;
    config;
    api;
    cachedAccessories = new Map();
    activeAccessories = new Map();
    client = null;
    pollIntervalMs;
    mode;
    explicitChannels;
    eve;
    tokenCachePath;
    pollTimer = null;
    discoveryDone = false;
    constructor(log, config, api) {
        this.log = log;
        this.config = config;
        this.api = api;
        this.eve = (0, eveCharacteristics_1.buildEveCharacteristics)(api);
        this.tokenCachePath = path.join(api.user.storagePath(), TOKEN_CACHE_FILE);
        const interval = Math.max(settings_1.MIN_POLL_INTERVAL_SECONDS, Number(config.pollInterval) || settings_1.DEFAULT_POLL_INTERVAL_SECONDS);
        this.pollIntervalMs = interval * 1000;
        this.mode = config.mode === 'perPhase' ? 'perPhase' : 'combined';
        const channels = Array.isArray(config.channels) ? config.channels.filter(Number.isFinite) : [];
        this.explicitChannels = channels.length > 0 ? channels : null;
        this.api.on('didFinishLaunching', () => {
            void this.didFinishLaunching();
        });
        this.api.on('shutdown', () => {
            if (this.pollTimer) {
                clearInterval(this.pollTimer);
                this.pollTimer = null;
            }
        });
    }
    configureAccessory(accessory) {
        this.log.debug(`Loading cached accessory: ${accessory.displayName} (${accessory.UUID})`);
        this.cachedAccessories.set(accessory.UUID, accessory);
    }
    async didFinishLaunching() {
        this.client = await this.initClient();
        if (!this.client) {
            this.log.warn('Skipping discovery — Supla client not initialised. Open plugin settings in Config UI X.');
            return;
        }
        this.log.info(`Supla server: ${this.client.getBaseUrl()}`);
        await this.tick();
        this.pollTimer = setInterval(() => {
            void this.tick();
        }, this.pollIntervalMs);
    }
    async initClient() {
        const credentials = this.credentialsFromConfig();
        if (!credentials)
            return null;
        const cached = await this.readTokenCache();
        const isSameIdentity = cached
            && cached.clientId === credentials.clientId
            && cached.serverUrl === credentials.serverUrl;
        let initial;
        if (isSameIdentity && cached) {
            initial = cached.tokens;
            this.log.debug('Loaded cached OAuth tokens from disk.');
        }
        else {
            const refreshToken = (this.config.refreshToken ?? '').trim();
            if (!refreshToken) {
                this.log.error('Missing refresh token. Authorize the plugin in Config UI X.');
                return null;
            }
            initial = {
                refreshToken,
                accessToken: (this.config.accessToken ?? '').trim(),
                accessTokenExpiresAt: Number(this.config.accessTokenExpiresAt) || 0,
            };
        }
        return new suplaClient_1.SuplaClient(credentials, initial, (tokens) => this.onTokensUpdated(credentials, tokens));
    }
    credentialsFromConfig() {
        const clientId = (this.config.clientId ?? '').trim();
        const clientSecret = (this.config.clientSecret ?? '').trim();
        const serverUrl = (this.config.serverUrl ?? '').trim();
        if (!clientId || !clientSecret || !serverUrl) {
            this.log.error('Missing OAuth credentials. Open the plugin settings in Config UI X and complete authorization.');
            return null;
        }
        return { clientId, clientSecret, serverUrl: serverUrl.replace(/\/+$/, '') };
    }
    async readTokenCache() {
        try {
            const raw = await fs_1.promises.readFile(this.tokenCachePath, 'utf-8');
            return JSON.parse(raw);
        }
        catch {
            return null;
        }
    }
    async onTokensUpdated(credentials, tokens) {
        const payload = {
            clientId: credentials.clientId,
            serverUrl: credentials.serverUrl,
            tokens,
        };
        try {
            await fs_1.promises.writeFile(this.tokenCachePath, JSON.stringify(payload, null, 2), 'utf-8');
            this.log.debug('Persisted rotated OAuth tokens to disk.');
        }
        catch (e) {
            this.log.warn(`Failed to persist token cache: ${e.message}`);
        }
    }
    async tick() {
        if (!this.client)
            return;
        let meters;
        try {
            meters = await this.fetchMeters();
        }
        catch (e) {
            if (e instanceof suplaClient_1.SuplaApiError) {
                this.log.warn(`Supla API ${e.status}: ${e.message}`);
            }
            else if (e instanceof suplaClient_1.SuplaOAuthError) {
                this.log.error(`OAuth error: ${e.message}${e.body ? ` (${e.body})` : ''}`);
            }
            else {
                this.log.warn(`Polling error: ${e.message}`);
            }
            return;
        }
        if (!this.discoveryDone) {
            this.syncAccessories(meters);
            this.discoveryDone = true;
        }
        for (const channel of meters) {
            const contexts = this.contextsForChannel(channel);
            for (const ctx of contexts) {
                const uuid = this.api.hap.uuid.generate(accessory_1.MeterAccessory.uuidSeedFor(ctx));
                const accessory = this.activeAccessories.get(uuid);
                if (accessory) {
                    accessory.beat(channel);
                }
            }
        }
    }
    async fetchMeters() {
        if (!this.client)
            return [];
        if (this.explicitChannels) {
            const results = await Promise.all(this.explicitChannels.map((id) => this.client.getChannel(id).catch((e) => {
                this.log.warn(`Failed to fetch channel ${id}: ${e.message}`);
                return null;
            })));
            return results.filter((c) => c !== null);
        }
        return this.client.listElectricityMeters();
    }
    syncAccessories(meters) {
        const desiredUuids = new Set();
        for (const channel of meters) {
            const contexts = this.contextsForChannel(channel);
            for (const ctx of contexts) {
                const uuid = this.api.hap.uuid.generate(accessory_1.MeterAccessory.uuidSeedFor(ctx));
                desiredUuids.add(uuid);
                const cached = this.cachedAccessories.get(uuid);
                const displayName = accessory_1.MeterAccessory.displayNameFor(channel, ctx);
                if (cached) {
                    cached.context = ctx;
                    cached.displayName = displayName;
                    this.api.updatePlatformAccessories([cached]);
                    this.activeAccessories.set(uuid, new accessory_1.MeterAccessory(this.api, this.log, cached, this.eve));
                    this.log.info(`Restored accessory from cache: ${displayName}`);
                }
                else {
                    const accessory = new this.api.platformAccessory(displayName, uuid);
                    accessory.context = ctx;
                    this.activeAccessories.set(uuid, new accessory_1.MeterAccessory(this.api, this.log, accessory, this.eve));
                    this.api.registerPlatformAccessories(settings_1.PLUGIN_NAME, settings_1.PLATFORM_NAME, [accessory]);
                    this.log.info(`Registered new accessory: ${displayName}`);
                }
            }
        }
        for (const [uuid, cached] of this.cachedAccessories) {
            if (!desiredUuids.has(uuid)) {
                this.log.info(`Unregistering orphaned accessory: ${cached.displayName}`);
                this.api.unregisterPlatformAccessories(settings_1.PLUGIN_NAME, settings_1.PLATFORM_NAME, [cached]);
                this.cachedAccessories.delete(uuid);
            }
        }
    }
    contextsForChannel(channel) {
        if (this.mode === 'combined') {
            return [{ channelId: channel.id, kind: 'combined' }];
        }
        const phases = channel.state?.phases ?? [];
        return phases.map((p) => ({
            channelId: channel.id,
            kind: 'phase',
            phaseNumber: p.number,
        }));
    }
}
exports.SuplaMew01Platform = SuplaMew01Platform;
//# sourceMappingURL=platform.js.map