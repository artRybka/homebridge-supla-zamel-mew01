import type { API, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig } from 'homebridge';
export type PresentationMode = 'combined' | 'perPhase';
export interface SuplaMew01Config extends PlatformConfig {
    clientId?: string;
    clientSecret?: string;
    serverUrl?: string;
    refreshToken?: string;
    accessToken?: string;
    accessTokenExpiresAt?: number;
    pollInterval?: number;
    mode?: PresentationMode;
    channels?: number[];
}
export declare class SuplaMew01Platform implements DynamicPlatformPlugin {
    readonly log: Logging;
    readonly config: SuplaMew01Config;
    readonly api: API;
    private readonly cachedAccessories;
    private readonly activeAccessories;
    private client;
    private readonly pollIntervalMs;
    private readonly mode;
    private readonly explicitChannels;
    private readonly eve;
    private readonly tokenCachePath;
    private pollTimer;
    private discoveryDone;
    constructor(log: Logging, config: SuplaMew01Config, api: API);
    configureAccessory(accessory: PlatformAccessory): void;
    private didFinishLaunching;
    private initClient;
    private credentialsFromConfig;
    private readTokenCache;
    private onTokensUpdated;
    private tick;
    private fetchMeters;
    private syncAccessories;
    private contextsForChannel;
}
