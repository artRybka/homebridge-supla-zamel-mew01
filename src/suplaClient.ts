import { ELECTRICITY_METER_FUNCTION_ID } from './settings';

export interface Phase {
  number: 1 | 2 | 3;
  voltage: number;
  current: number;
  frequency: number;
  powerActive: number;
  powerReactive: number;
  powerApparent: number;
  powerFactor: number;
  phaseAngle?: number;
  totalForwardActiveEnergy: number;
  totalReverseActiveEnergy: number;
  totalForwardReactiveEnergy?: number;
  totalReverseReactiveEnergy?: number;
}

export interface ChannelState {
  connected: boolean;
  phases: Phase[];
}

export interface ChannelFunction {
  id: number;
  name: string;
}

export interface Channel {
  id: number;
  functionId: number;
  function?: ChannelFunction;
  caption: string | null;
  state?: ChannelState;
}

export class SuplaApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(message);
    this.name = 'SuplaApiError';
  }
}

export class SuplaTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SuplaTokenError';
  }
}

export class SuplaClient {
  private readonly baseUrl: string;

  constructor(
    private readonly token: string,
    explicitServerUrl?: string,
  ) {
    if (!token || token.trim().length === 0) {
      throw new SuplaTokenError('Empty access token');
    }

    const trimmed = explicitServerUrl?.trim();
    if (trimmed) {
      this.baseUrl = SuplaClient.normalizeUrl(trimmed);
    } else {
      this.baseUrl = SuplaClient.decodeServerFromToken(token);
    }
  }

  static decodeServerFromToken(token: string): string {
    const parts = token.split('.');
    if (parts.length !== 2) {
      throw new SuplaTokenError(
        'Invalid token format — expected "{tokenHex}.{base64Url}"',
      );
    }

    let decoded: string;
    try {
      decoded = Buffer.from(parts[1], 'base64').toString('utf-8').trim();
    } catch {
      throw new SuplaTokenError('Failed to base64-decode the server segment of the token');
    }

    if (!/^https?:\/\//i.test(decoded)) {
      throw new SuplaTokenError(
        `Decoded server URL looks invalid: "${decoded}". Provide serverUrl manually.`,
      );
    }

    return SuplaClient.normalizeUrl(decoded);
  }

  private static normalizeUrl(url: string): string {
    return url.replace(/\/+$/, '');
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  async listElectricityMeters(): Promise<Channel[]> {
    const all = await this.request<Channel[]>('/api/v3/channels?include=state');
    return all.filter((c) => c.functionId === ELECTRICITY_METER_FUNCTION_ID);
  }

  async getChannel(id: number): Promise<Channel> {
    return this.request<Channel>(`/api/v3/channels/${id}?include=state`);
  }

  private async request<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new SuplaApiError(
        `Supla API ${res.status} ${res.statusText} for ${path}`,
        res.status,
        body,
      );
    }

    return (await res.json()) as T;
  }
}
