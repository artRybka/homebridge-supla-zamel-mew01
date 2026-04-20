const { HomebridgePluginUiServer, RequestError } = require('@homebridge/plugin-ui-utils');

class UiServer extends HomebridgePluginUiServer {
  constructor() {
    super();

    this.onRequest('/test-connection', this.testConnection.bind(this));

    this.ready();
  }

  loadSuplaClient() {
    try {
      return require('../dist/suplaClient');
    } catch (e) {
      throw new RequestError(
        'Plugin build artifacts not found. Run `npm run build` in the plugin directory and reload Homebridge.',
        { status: 500, originalError: String(e) },
      );
    }
  }

  async testConnection(payload) {
    const accessToken = (payload && payload.accessToken || '').trim();
    const serverUrl = (payload && payload.serverUrl || '').trim() || undefined;

    if (!accessToken) {
      throw new RequestError('Access token is required.', { status: 400 });
    }
    if (!accessToken.includes('.')) {
      throw new RequestError(
        'Invalid token format — expected "{tokenHex}.{base64Url}". Paste the full token from Supla Cloud.',
        { status: 400 },
      );
    }

    const { SuplaClient, SuplaApiError, SuplaTokenError } = this.loadSuplaClient();

    let client;
    try {
      client = new SuplaClient(accessToken, serverUrl);
    } catch (e) {
      if (e instanceof SuplaTokenError) {
        throw new RequestError(e.message, { status: 400 });
      }
      throw new RequestError(`Token initialisation failed: ${e.message}`, { status: 400 });
    }

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
          ? 'Token rejected — verify the scope `channels_r` is granted and the token has not expired.'
          : `Supla API responded with ${e.status}.`;
        throw new RequestError(hint, { status: e.status, body: e.body });
      }
      throw new RequestError(`Network error: ${e.message}`, { status: 502 });
    }
  }
}

new UiServer();
