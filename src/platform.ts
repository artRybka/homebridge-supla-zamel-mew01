import { promises as fs } from 'fs';
import * as path from 'path';

import type {
  API,
  DynamicPlatformPlugin,
  Logging,
  PlatformAccessory,
  PlatformConfig,
} from 'homebridge';

import {
  AccessoryContext,
  AccessoryKind,
  MeterAccessory,
} from './accessory';
import {
  buildEveCharacteristics,
  type EveCharacteristicSet,
} from './eveCharacteristics';
import {
  DEFAULT_POLL_INTERVAL_SECONDS,
  MIN_POLL_INTERVAL_SECONDS,
  PLATFORM_NAME,
  PLUGIN_NAME,
} from './settings';
import {
  Channel,
  OAuthTokens,
  SuplaApiError,
  SuplaClient,
  SuplaOAuthCredentials,
  SuplaOAuthError,
} from './suplaClient';

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

interface TokenCacheFile {
  clientId: string;
  serverUrl: string;
  tokens: OAuthTokens;
}

const TOKEN_CACHE_FILE = 'supla-mew01-tokens.json';

export class SuplaMew01Platform implements DynamicPlatformPlugin {
  private readonly cachedAccessories = new Map<string, PlatformAccessory<AccessoryContext>>();
  private readonly activeAccessories = new Map<string, MeterAccessory>();
  private client: SuplaClient | null = null;
  private readonly pollIntervalMs: number;
  private readonly mode: PresentationMode;
  private readonly explicitChannels: number[] | null;
  private readonly eve: EveCharacteristicSet;
  private readonly tokenCachePath: string;
  private pollTimer: NodeJS.Timeout | null = null;
  private discoveryDone = false;

  constructor(
    public readonly log: Logging,
    public readonly config: SuplaMew01Config,
    public readonly api: API,
  ) {
    this.eve = buildEveCharacteristics(api);
    this.tokenCachePath = path.join(api.user.storagePath(), TOKEN_CACHE_FILE);

    const interval = Math.max(
      MIN_POLL_INTERVAL_SECONDS,
      Number(config.pollInterval) || DEFAULT_POLL_INTERVAL_SECONDS,
    );
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

  configureAccessory(accessory: PlatformAccessory): void {
    this.log.debug(`Loading cached accessory: ${accessory.displayName} (${accessory.UUID})`);
    this.cachedAccessories.set(accessory.UUID, accessory as PlatformAccessory<AccessoryContext>);
  }

  private async didFinishLaunching(): Promise<void> {
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

  private async initClient(): Promise<SuplaClient | null> {
    const credentials = this.credentialsFromConfig();
    if (!credentials) return null;

    const cached = await this.readTokenCache();
    const isSameIdentity = cached
      && cached.clientId === credentials.clientId
      && cached.serverUrl === credentials.serverUrl;

    let initial: OAuthTokens;
    if (isSameIdentity && cached) {
      initial = cached.tokens;
      this.log.debug('Loaded cached OAuth tokens from disk.');
    } else {
      const refreshToken = (this.config.refreshToken ?? '').trim() || null;
      const accessToken = (this.config.accessToken ?? '').trim();
      if (!refreshToken && !accessToken) {
        this.log.error('Missing OAuth tokens. Authorize the plugin in Config UI X.');
        return null;
      }
      initial = {
        refreshToken,
        accessToken,
        accessTokenExpiresAt: Number(this.config.accessTokenExpiresAt) || 0,
      };
    }

    if (!initial.refreshToken) {
      const expiresIn = Math.max(0, Math.floor((initial.accessTokenExpiresAt - Date.now()) / 1000));
      this.log.warn(
        `Supla did not issue a refresh token for this OAuth app. Access token expires in ~${expiresIn}s — ` +
          're-authorize in Config UI X when that happens.',
      );
    }

    return new SuplaClient(
      credentials,
      initial,
      (tokens) => this.onTokensUpdated(credentials, tokens),
    );
  }

  private credentialsFromConfig(): SuplaOAuthCredentials | null {
    const clientId = (this.config.clientId ?? '').trim();
    const clientSecret = (this.config.clientSecret ?? '').trim();
    const serverUrl = (this.config.serverUrl ?? '').trim();

    if (!clientId || !clientSecret || !serverUrl) {
      this.log.error('Missing OAuth credentials. Open the plugin settings in Config UI X and complete authorization.');
      return null;
    }

    return { clientId, clientSecret, serverUrl: serverUrl.replace(/\/+$/, '') };
  }

  private async readTokenCache(): Promise<TokenCacheFile | null> {
    try {
      const raw = await fs.readFile(this.tokenCachePath, 'utf-8');
      return JSON.parse(raw) as TokenCacheFile;
    } catch {
      return null;
    }
  }

  private async onTokensUpdated(credentials: SuplaOAuthCredentials, tokens: OAuthTokens): Promise<void> {
    const payload: TokenCacheFile = {
      clientId: credentials.clientId,
      serverUrl: credentials.serverUrl,
      tokens,
    };
    try {
      await fs.writeFile(this.tokenCachePath, JSON.stringify(payload, null, 2), 'utf-8');
      this.log.debug('Persisted rotated OAuth tokens to disk.');
    } catch (e) {
      this.log.warn(`Failed to persist token cache: ${(e as Error).message}`);
    }
  }

  private async tick(): Promise<void> {
    if (!this.client) return;

    let meters: Channel[];
    try {
      meters = await this.fetchMeters();
    } catch (e) {
      if (e instanceof SuplaApiError) {
        this.log.warn(`Supla API ${e.status}: ${e.message}`);
      } else if (e instanceof SuplaOAuthError) {
        this.log.error(`OAuth error: ${e.message}${e.body ? ` (${e.body})` : ''}`);
      } else {
        this.log.warn(`Polling error: ${(e as Error).message}`);
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
        const uuid = this.api.hap.uuid.generate(MeterAccessory.uuidSeedFor(ctx));
        const accessory = this.activeAccessories.get(uuid);
        if (accessory) {
          accessory.beat(channel);
        }
      }
    }
  }

  private async fetchMeters(): Promise<Channel[]> {
    if (!this.client) return [];

    if (this.explicitChannels) {
      const results = await Promise.all(
        this.explicitChannels.map((id) =>
          this.client!.getChannel(id).catch((e) => {
            this.log.warn(`Failed to fetch channel ${id}: ${(e as Error).message}`);
            return null;
          }),
        ),
      );
      return results.filter((c): c is Channel => c !== null);
    }

    return this.client.listElectricityMeters();
  }

  private syncAccessories(meters: Channel[]): void {
    const desiredUuids = new Set<string>();

    for (const channel of meters) {
      const contexts = this.contextsForChannel(channel);
      for (const ctx of contexts) {
        const uuid = this.api.hap.uuid.generate(MeterAccessory.uuidSeedFor(ctx));
        desiredUuids.add(uuid);

        const cached = this.cachedAccessories.get(uuid);
        const displayName = MeterAccessory.displayNameFor(channel, ctx);

        if (cached) {
          cached.context = ctx;
          cached.displayName = displayName;
          this.api.updatePlatformAccessories([cached]);
          this.activeAccessories.set(uuid, new MeterAccessory(this.api, this.log, cached, this.eve));
          this.log.info(`Restored accessory from cache: ${displayName}`);
        } else {
          const accessory = new this.api.platformAccessory<AccessoryContext>(displayName, uuid);
          accessory.context = ctx;
          this.activeAccessories.set(uuid, new MeterAccessory(this.api, this.log, accessory, this.eve));
          this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
          this.log.info(`Registered new accessory: ${displayName}`);
        }
      }
    }

    for (const [uuid, cached] of this.cachedAccessories) {
      if (!desiredUuids.has(uuid)) {
        this.log.info(`Unregistering orphaned accessory: ${cached.displayName}`);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [cached]);
        this.cachedAccessories.delete(uuid);
      }
    }
  }

  private contextsForChannel(channel: Channel): AccessoryContext[] {
    if (this.mode === 'combined') {
      return [{ channelId: channel.id, kind: 'combined' as AccessoryKind }];
    }

    const phases = channel.state?.phases ?? [];
    return phases.map<AccessoryContext>((p) => ({
      channelId: channel.id,
      kind: 'phase' as AccessoryKind,
      phaseNumber: p.number,
    }));
  }
}
