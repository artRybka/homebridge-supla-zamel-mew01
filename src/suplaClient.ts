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

export interface SuplaOAuthCredentials {
  clientId: string;
  clientSecret: string;
  serverUrl: string;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string | null;
  accessTokenExpiresAt: number;
}

export const DEFAULT_REDIRECT_URI = 'http://localhost';
export const DEFAULT_OAUTH_SCOPE = 'channels_r offline_access';

interface TokenEndpointResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope: string;
  target_url?: string;
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

export class SuplaOAuthError extends Error {
  constructor(message: string, public readonly body?: string) {
    super(message);
    this.name = 'SuplaOAuthError';
  }
}

export function normalizeServerUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

export class SuplaClient {
  private readonly credentials: SuplaOAuthCredentials;
  private accessToken: string | null;
  private accessTokenExpiresAt: number;
  private refreshToken: string | null;
  private refreshingPromise: Promise<void> | null = null;

  constructor(
    credentials: SuplaOAuthCredentials,
    initialTokens: OAuthTokens,
    private readonly onTokensUpdated?: (tokens: OAuthTokens) => void,
  ) {
    this.credentials = {
      ...credentials,
      serverUrl: normalizeServerUrl(credentials.serverUrl),
    };
    this.accessToken = initialTokens.accessToken || null;
    this.refreshToken = initialTokens.refreshToken ?? null;
    this.accessTokenExpiresAt = initialTokens.accessTokenExpiresAt || 0;
  }

  static buildAuthorizeUrl(
    credentials: SuplaOAuthCredentials,
    state: string,
    scope: string = DEFAULT_OAUTH_SCOPE,
    redirectUri: string = DEFAULT_REDIRECT_URI,
  ): string {
    const base = normalizeServerUrl(credentials.serverUrl);
    const params = new URLSearchParams({
      client_id: credentials.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope,
      state,
    });
    return `${base}/oauth/v2/auth?${params.toString()}`;
  }

  static async exchangeCode(
    credentials: SuplaOAuthCredentials,
    code: string,
    redirectUri: string = DEFAULT_REDIRECT_URI,
  ): Promise<OAuthTokens> {
    return SuplaClient.tokenRequest(credentials, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    });
  }

  private static async tokenRequest(
    credentials: SuplaOAuthCredentials,
    params: Record<string, string>,
  ): Promise<OAuthTokens> {
    const base = normalizeServerUrl(credentials.serverUrl);
    const basicAuth =
      'Basic ' + Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64');

    const bodyWithCreds = new URLSearchParams({
      ...params,
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
    });

    const doFetch = async (useBasic: boolean, bodyParams: URLSearchParams) => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      };
      if (useBasic) headers['Authorization'] = basicAuth;
      const res = await fetch(`${base}/oauth/v2/token`, {
        method: 'POST',
        headers,
        body: bodyParams,
      });
      const text = await res.text();
      return { status: res.status, ok: res.ok, text };
    };

    // First: Basic Auth + creds in body (most servers accept this; RFC-compliant)
    let resp = await doFetch(true, bodyWithCreds);

    // Fallback: no Basic Auth (some servers reject duplicate credentials)
    if (!resp.ok) {
      const fallback = await doFetch(false, bodyWithCreds);
      if (fallback.ok || fallback.status !== resp.status) {
        resp = fallback;
      }
    }

    if (!resp.ok) {
      throw new SuplaOAuthError(
        `Token endpoint HTTP ${resp.status}`,
        resp.text,
      );
    }

    let data: TokenEndpointResponse;
    try {
      data = JSON.parse(resp.text) as TokenEndpointResponse;
    } catch {
      throw new SuplaOAuthError('Token endpoint returned invalid JSON', resp.text);
    }

    if (!data.access_token) {
      throw new SuplaOAuthError('Token endpoint response missing access_token', resp.text);
    }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? null,
      accessTokenExpiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    };
  }

  getBaseUrl(): string {
    return this.credentials.serverUrl;
  }

  async listElectricityMeters(): Promise<Channel[]> {
    const all = await this.request<Channel[]>('/api/v3/channels?include=state');
    return all.filter((c) => c.functionId === ELECTRICITY_METER_FUNCTION_ID);
  }

  async getChannel(id: number): Promise<Channel> {
    return this.request<Channel>(`/api/v3/channels/${id}?include=state`);
  }

  private async ensureAccessToken(): Promise<string> {
    const skewMs = 60_000;
    if (this.accessToken && Date.now() < this.accessTokenExpiresAt - skewMs) {
      return this.accessToken;
    }
    await this.refreshTokens();
    if (!this.accessToken) {
      throw new SuplaOAuthError('Access token unavailable after refresh');
    }
    return this.accessToken;
  }

  private async refreshTokens(): Promise<void> {
    if (this.refreshingPromise) {
      return this.refreshingPromise;
    }

    if (!this.refreshToken) {
      throw new SuplaOAuthError(
        'Access token expired and no refresh token available. Re-authorize the plugin in Config UI X.',
      );
    }

    const refreshToken = this.refreshToken;

    this.refreshingPromise = (async () => {
      const tokens = await SuplaClient.tokenRequest(this.credentials, {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      });

      this.accessToken = tokens.accessToken;
      this.accessTokenExpiresAt = tokens.accessTokenExpiresAt;
      if (tokens.refreshToken) {
        this.refreshToken = tokens.refreshToken;
      }

      this.onTokensUpdated?.({
        accessToken: this.accessToken,
        refreshToken: this.refreshToken,
        accessTokenExpiresAt: this.accessTokenExpiresAt,
      });
    })();

    try {
      await this.refreshingPromise;
    } finally {
      this.refreshingPromise = null;
    }
  }

  private async request<T>(path: string, retryCount = 0): Promise<T> {
    const token = await this.ensureAccessToken();
    const res = await fetch(`${this.credentials.serverUrl}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });

    if (res.status === 401 && retryCount === 0) {
      this.accessToken = null;
      this.accessTokenExpiresAt = 0;
      return this.request<T>(path, 1);
    }

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
