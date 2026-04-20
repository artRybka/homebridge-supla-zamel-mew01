"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SuplaMew01Platform = void 0;
const accessory_1 = require("./accessory");
const eveCharacteristics_1 = require("./eveCharacteristics");
const settings_1 = require("./settings");
const suplaClient_1 = require("./suplaClient");
class SuplaMew01Platform {
    log;
    config;
    api;
    cachedAccessories = new Map();
    activeAccessories = new Map();
    client;
    pollIntervalMs;
    mode;
    explicitChannels;
    eve;
    pollTimer = null;
    discoveryDone = false;
    constructor(log, config, api) {
        this.log = log;
        this.config = config;
        this.api = api;
        this.eve = (0, eveCharacteristics_1.buildEveCharacteristics)(api);
        const token = (config.accessToken ?? '').trim();
        const serverUrl = (config.serverUrl ?? '').trim() || undefined;
        if (!token) {
            this.log.error('No accessToken configured. Open the plugin settings in Config UI X and paste your Supla PAT.');
            this.client = null;
        }
        else {
            try {
                this.client = new suplaClient_1.SuplaClient(token, serverUrl);
                this.log.info(`Supla server: ${this.client.getBaseUrl()}`);
            }
            catch (e) {
                if (e instanceof suplaClient_1.SuplaTokenError) {
                    this.log.error(`Invalid Supla token: ${e.message}`);
                }
                else {
                    this.log.error(`Failed to initialise Supla client: ${e.message}`);
                }
                this.client = null;
            }
        }
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
        if (!this.client) {
            this.log.warn('Skipping discovery — Supla client not initialised.');
            return;
        }
        await this.tick();
        this.pollTimer = setInterval(() => {
            void this.tick();
        }, this.pollIntervalMs);
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