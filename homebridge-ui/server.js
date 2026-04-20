const { HomebridgePluginUiServer, RequestError } = require('@homebridge/plugin-ui-utils');

class UiServer extends HomebridgePluginUiServer {
  constructor() {
    super();

    this.onRequest('/build-authorize-url', this.buildAuthorizeUrl.bind(this));
    this.onRequest('/exchange-code', this.exchangeCode.bind(this));
    this.onRequest('/test-connection', this.testConnection.bind(this));

    this.ready();
  }

  loadSuplaModule() {
    try {
      return require('../dist/suplaClient');
    } catch (e) {
      throw new RequestError(
        'Plugin build artifacts not found. Reinstall the plugin or run `npm run build`.',
        { status: 500, originalError: String(e) },
      );
    }
  }

  normalizeServerUrl(raw) {
    const trimmed = String(raw || '').trim();
    if (!trimmed) return '';
    if (!/^https?:\/\//i.test(trimmed)) {
      return `https://${trimmed}`.replace(/\/+$/, '');
    }
    return trimmed.replace(/\/+$/, '');
  }

  extractCodeFromInput(raw) {
    const input = String(raw || '').trim();
    if (!input) return '';
    if (input.includes('?') || input.includes('&')) {
      try {
        const url = input.startsWith('http') ? new URL(input) : new URL(`http://placeholder/?${input.replace(/^[?&]/, '')}`);
        const code = url.searchParams.get('code');
        if (code) return code;
      } catch {
        // fall through — treat as raw code
      }
    }
    return input;
  }

  validateCredentials(payload) {
    const clientId = String(payload?.clientId || '').trim();
    const clientSecret = String(payload?.clientSecret || '').trim();
    const serverUrl = this.normalizeServerUrl(payload?.serverUrl);

    if (!clientId) throw new RequestError('Client ID is required.', { status: 400 });
    if (!clientSecret) throw new RequestError('Client Secret is required.', { status: 400 });
    if (!serverUrl) throw new RequestError('Server URL is required (e.g. https://svr57.supla.org).', { status: 400 });

    return { clientId, clientSecret, serverUrl };
  }

  async buildAuthorizeUrl(payload) {
    const credentials = this.validateCredentials(payload);
    const { SuplaClient } = this.loadSuplaModule();
    const state = 'hb-' + Math.random().toString(36).slice(2, 10);
    const url = SuplaClient.buildAuthorizeUrl(credentials, state);
    return { url, state };
  }

  async exchangeCode(payload) {
    const credentials = this.validateCredentials(payload);
    const code = this.extractCodeFromInput(payload?.code);

    if (!code) {
      throw new RequestError('Paste the authorization code or the callback URL.', { status: 400 });
    }

    const { SuplaClient, SuplaOAuthError } = this.loadSuplaModule();
    try {
      const tokens = await SuplaClient.exchangeCode(credentials, code);
      return { success: true, tokens };
    } catch (e) {
      if (e instanceof SuplaOAuthError) {
        throw new RequestError(e.message, { status: 400, body: e.body });
      }
      throw new RequestError(`Network error: ${e.message || e}`, { status: 502 });
    }
  }

  async testConnection(payload) {
    const credentials = this.validateCredentials(payload);
    const tokens = payload?.tokens;
    if (!tokens || !tokens.refreshToken) {
      throw new RequestError('Authorize with Supla first to obtain tokens.', { status: 400 });
    }

    const { SuplaClient, SuplaApiError, SuplaOAuthError } = this.loadSuplaModule();
    const client = new SuplaClient(credentials, {
      accessToken: tokens.accessToken || '',
      refreshToken: tokens.refreshToken,
      accessTokenExpiresAt: tokens.accessTokenExpiresAt || 0,
    });

    try {
      const meters = await client.listElectricityMeters();
      return {
        success: true,
        serverUrl: client.getBaseUrl(),
        meters: meters.map((m) => ({
          id: m.id,
          caption: (m.caption && m.caption.trim()) || `Meter ${m.id}`,
          phaseCount: (m.state && Array.isArray(m.state.phases)) ? m.state.phases.length : 0,
          connected: !!(m.state && m.state.connected),
        })),
      };
    } catch (e) {
      if (e instanceof SuplaApiError) {
        const hint = e.status === 401
          ? 'Token rejected — re-authorize with Supla to get a fresh refresh token.'
          : `Supla API responded with ${e.status}.`;
        throw new RequestError(hint, { status: e.status, body: e.body });
      }
      if (e instanceof SuplaOAuthError) {
        throw new RequestError(`OAuth error: ${e.message}`, { status: 400, body: e.body });
      }
      throw new RequestError(`Network error: ${e.message || e}`, { status: 502 });
    }
  }
}

new UiServer();
