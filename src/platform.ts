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
  SuplaApiError,
  SuplaClient,
  SuplaTokenError,
} from './suplaClient';

export type PresentationMode = 'combined' | 'perPhase';

export interface SuplaMew01Config extends PlatformConfig {
  accessToken?: string;
  serverUrl?: string;
  pollInterval?: number;
  mode?: PresentationMode;
  channels?: number[];
}

export class SuplaMew01Platform implements DynamicPlatformPlugin {
  private readonly cachedAccessories = new Map<string, PlatformAccessory<AccessoryContext>>();
  private readonly activeAccessories = new Map<string, MeterAccessory>();
  private readonly client: SuplaClient | null;
  private readonly pollIntervalMs: number;
  private readonly mode: PresentationMode;
  private readonly explicitChannels: number[] | null;
  private readonly eve: EveCharacteristicSet;
  private pollTimer: NodeJS.Timeout | null = null;
  private discoveryDone = false;

  constructor(
    public readonly log: Logging,
    public readonly config: SuplaMew01Config,
    public readonly api: API,
  ) {
    this.eve = buildEveCharacteristics(api);

    const token = (config.accessToken ?? '').trim();
    const serverUrl = (config.serverUrl ?? '').trim() || undefined;

    if (!token) {
      this.log.error(
        'No accessToken configured. Open the plugin settings in Config UI X and paste your Supla PAT.',
      );
      this.client = null;
    } else {
      try {
        this.client = new SuplaClient(token, serverUrl);
        this.log.info(`Supla server: ${this.client.getBaseUrl()}`);
      } catch (e) {
        if (e instanceof SuplaTokenError) {
          this.log.error(`Invalid Supla token: ${e.message}`);
        } else {
          this.log.error(`Failed to initialise Supla client: ${(e as Error).message}`);
        }
        this.client = null;
      }
    }

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
    if (!this.client) {
      this.log.warn('Skipping discovery — Supla client not initialised.');
      return;
    }

    await this.tick();
    this.pollTimer = setInterval(() => {
      void this.tick();
    }, this.pollIntervalMs);
  }

  private async tick(): Promise<void> {
    if (!this.client) return;

    let meters: Channel[];
    try {
      meters = await this.fetchMeters();
    } catch (e) {
      if (e instanceof SuplaApiError) {
        this.log.warn(`Supla API ${e.status}: ${e.message}`);
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
