"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SuplaClient = exports.SuplaTokenError = exports.SuplaApiError = void 0;
const settings_1 = require("./settings");
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
class SuplaTokenError extends Error {
    constructor(message) {
        super(message);
        this.name = 'SuplaTokenError';
    }
}
exports.SuplaTokenError = SuplaTokenError;
class SuplaClient {
    token;
    baseUrl;
    constructor(token, explicitServerUrl) {
        this.token = token;
        if (!token || token.trim().length === 0) {
            throw new SuplaTokenError('Empty access token');
        }
        const trimmed = explicitServerUrl?.trim();
        if (trimmed) {
            this.baseUrl = SuplaClient.normalizeUrl(trimmed);
        }
        else {
            this.baseUrl = SuplaClient.decodeServerFromToken(token);
        }
    }
    static decodeServerFromToken(token) {
        const parts = token.split('.');
        if (parts.length !== 2) {
            throw new SuplaTokenError('Invalid token format — expected "{tokenHex}.{base64Url}"');
        }
        let decoded;
        try {
            decoded = Buffer.from(parts[1], 'base64').toString('utf-8').trim();
        }
        catch {
            throw new SuplaTokenError('Failed to base64-decode the server segment of the token');
        }
        if (!/^https?:\/\//i.test(decoded)) {
            throw new SuplaTokenError(`Decoded server URL looks invalid: "${decoded}". Provide serverUrl manually.`);
        }
        return SuplaClient.normalizeUrl(decoded);
    }
    static normalizeUrl(url) {
        return url.replace(/\/+$/, '');
    }
    getBaseUrl() {
        return this.baseUrl;
    }
    async listElectricityMeters() {
        const all = await this.request('/api/v3/channels?include=state');
        return all.filter((c) => c.functionId === settings_1.ELECTRICITY_METER_FUNCTION_ID);
    }
    async getChannel(id) {
        return this.request(`/api/v3/channels/${id}?include=state`);
    }
    async request(path) {
        const url = `${this.baseUrl}${path}`;
        const res = await fetch(url, {
            headers: {
                Authorization: `Bearer ${this.token}`,
                Accept: 'application/json',
            },
        });
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            throw new SuplaApiError(`Supla API ${res.status} ${res.statusText} for ${path}`, res.status, body);
        }
        return (await res.json());
    }
}
exports.SuplaClient = SuplaClient;
//# sourceMappingURL=suplaClient.js.map