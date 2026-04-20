import type {
  API,
  DynamicPlatformPlugin,
  Logging,
  PlatformAccessory,
  PlatformConfig,
} from 'homebridge';

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
  private readonly cachedAccessories: PlatformAccessory[] = [];
  private readonly client: SuplaClient | null;
  private readonly pollIntervalMs: number;
  private readonly mode: PresentationMode;
  private readonly explicitChannels: number[] | null;
  private pollTimer: NodeJS.Timeout | null = null;

  constructor(
    public readonly log: Logging,
    public readonly config: SuplaMew01Config,
    public readonly api: API,
  ) {
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
    this.cachedAccessories.push(accessory);
  }

  private async didFinishLaunching(): Promise<void> {
    if (!this.client) {
      this.log.warn('Skipping discovery — Supla client not initialised.');
      return;
    }

    await this.discoverAndPoll();
    this.pollTimer = setInterval(() => {
      void this.discoverAndPoll();
    }, this.pollIntervalMs);
  }

  private async discoverAndPoll(): Promise<void> {
    if (!this.client) return;

    try {
      const meters = await this.fetchMeters();
      this.log.info(
        `Polled ${meters.length} meter(s) (mode=${this.mode}, interval=${this.pollIntervalMs / 1000}s).`,
      );
      // Accessory registration / beat() dispatch lands in the next commit.
      for (const m of meters) {
        const phases = m.state?.phases?.length ?? 0;
        const connected = m.state?.connected ?? false;
        this.log.debug(
          `  channel=${m.id} caption="${m.caption ?? ''}" phases=${phases} connected=${connected}`,
        );
      }
    } catch (e) {
      if (e instanceof SuplaApiError) {
        this.log.warn(`Supla API ${e.status}: ${e.message}`);
      } else {
        this.log.warn(`Polling error: ${(e as Error).message}`);
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

  // Helpers exposed for future accessory registration.
  getPluginIdentity(): { pluginName: string; platformName: string } {
    return { pluginName: PLUGIN_NAME, platformName: PLATFORM_NAME };
  }
}
