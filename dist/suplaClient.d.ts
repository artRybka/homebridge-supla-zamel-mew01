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
    refreshToken: string;
    accessTokenExpiresAt: number;
}
export declare const DEFAULT_REDIRECT_URI = "http://localhost";
export declare const DEFAULT_OAUTH_SCOPE = "channels_r";
export declare class SuplaApiError extends Error {
    readonly status: number;
    readonly body: string;
    constructor(message: string, status: number, body: string);
}
export declare class SuplaOAuthError extends Error {
    readonly body?: string | undefined;
    constructor(message: string, body?: string | undefined);
}
export declare function normalizeServerUrl(url: string): string;
export declare class SuplaClient {
    private readonly onTokensUpdated?;
    private readonly credentials;
    private accessToken;
    private accessTokenExpiresAt;
    private refreshToken;
    private refreshingPromise;
    constructor(credentials: SuplaOAuthCredentials, initialTokens: OAuthTokens, onTokensUpdated?: ((tokens: OAuthTokens) => void) | undefined);
    static buildAuthorizeUrl(credentials: SuplaOAuthCredentials, state: string, scope?: string, redirectUri?: string): string;
    static exchangeCode(credentials: SuplaOAuthCredentials, code: string, redirectUri?: string): Promise<OAuthTokens>;
    private static tokenRequest;
    getBaseUrl(): string;
    listElectricityMeters(): Promise<Channel[]>;
    getChannel(id: number): Promise<Channel>;
    private ensureAccessToken;
    private refreshTokens;
    private request;
}
