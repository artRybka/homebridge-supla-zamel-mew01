"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SuplaClient = exports.SuplaOAuthError = exports.SuplaApiError = exports.DEFAULT_OAUTH_SCOPE = exports.DEFAULT_REDIRECT_URI = void 0;
exports.normalizeServerUrl = normalizeServerUrl;
const settings_1 = require("./settings");
exports.DEFAULT_REDIRECT_URI = 'http://localhost';
exports.DEFAULT_OAUTH_SCOPE = 'channels_r';
class SuplaApiError extends Error {
    status;
    body;
    constructor(message, status, body) {
        super(message);
        this.status = status;
        this.body = body;
        this.name = 'SuplaApiError';
    }
}
exports.SuplaApiError = SuplaApiError;
class SuplaOAuthError extends Error {
    body;
    constructor(message, body) {
        super(message);
        this.body = body;
        this.name = 'SuplaOAuthError';
    }
}
exports.SuplaOAuthError = SuplaOAuthError;
function normalizeServerUrl(url) {
    return url.trim().replace(/\/+$/, '');
}
class SuplaClient {
    onTokensUpdated;
    credentials;
    accessToken;
    accessTokenExpiresAt;
    refreshToken;
    refreshingPromise = null;
    constructor(credentials, initialTokens, onTokensUpdated) {
        this.onTokensUpdated = onTokensUpdated;
        this.credentials = {
            ...credentials,
            serverUrl: normalizeServerUrl(credentials.serverUrl),
        };
        this.accessToken = initialTokens.accessToken || null;
        this.refreshToken = initialTokens.refreshToken;
        this.accessTokenExpiresAt = initialTokens.accessTokenExpiresAt || 0;
    }
    static buildAuthorizeUrl(credentials, state, scope = exports.DEFAULT_OAUTH_SCOPE, redirectUri = exports.DEFAULT_REDIRECT_URI) {
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
    static async exchangeCode(credentials, code, redirectUri = exports.DEFAULT_REDIRECT_URI) {
        const base = normalizeServerUrl(credentials.serverUrl);
        const body = new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            client_id: credentials.clientId,
            client_secret: credentials.clientSecret,
            redirect_uri: redirectUri,
        });
        const res = await fetch(`${base}/oauth/v2/token`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'application/json',
            },
            body,
        });
        const text = await res.text();
        if (!res.ok) {
            throw new SuplaOAuthError(`Authorization code exchange failed: HTTP ${res.status}`, text);
        }
        let data;
        try {
            data = JSON.parse(text);
        }
        catch {
            throw new SuplaOAuthError('Token endpoint returned invalid JSON', text);
        }
        if (!data.access_token || !data.refresh_token) {
            throw new SuplaOAuthError('Token endpoint response missing tokens', text);
        }
        return {
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            accessTokenExpiresAt: Date.now() + data.expires_in * 1000,
        };
    }
    getBaseUrl() {
        return this.credentials.serverUrl;
    }
    async listElectricityMeters() {
        const all = await this.request('/api/v3/channels?include=state');
        return all.filter((c) => c.functionId === settings_1.ELECTRICITY_METER_FUNCTION_ID);
    }
    async getChannel(id) {
        return this.request(`/api/v3/channels/${id}?include=state`);
    }
    async ensureAccessToken() {
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
    async refreshTokens() {
        if (this.refreshingPromise) {
            return this.refreshingPromise;
        }
        this.refreshingPromise = (async () => {
            const body = new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: this.refreshToken,
                client_id: this.credentials.clientId,
                client_secret: this.credentials.clientSecret,
            });
            const res = await fetch(`${this.credentials.serverUrl}/oauth/v2/token`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    Accept: 'application/json',
                },
                body,
            });
            const text = await res.text();
            if (!res.ok) {
                throw new SuplaOAuthError(`Refresh token exchange failed: HTTP ${res.status}`, text);
            }
            const data = JSON.parse(text);
            this.accessToken = data.access_token;
            this.accessTokenExpiresAt = Date.now() + data.expires_in * 1000;
            if (data.refresh_token) {
                this.refreshToken = data.refresh_token;
            }
            this.onTokensUpdated?.({
                accessToken: this.accessToken,
                refreshToken: this.refreshToken,
                accessTokenExpiresAt: this.accessTokenExpiresAt,
            });
        })();
        try {
            await this.refreshingPromise;
        }
        finally {
            this.refreshingPromise = null;
        }
    }
    async request(path, retryCount = 0) {
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
            return this.request(path, 1);
        }
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            throw new SuplaApiError(`Supla API ${res.status} ${res.statusText} for ${path}`, res.status, body);
        }
        return (await res.json());
    }
}
exports.SuplaClient = SuplaClient;
//# sourceMappingURL=suplaClient.js.map