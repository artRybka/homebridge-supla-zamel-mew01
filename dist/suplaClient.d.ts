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
export declare class SuplaApiError extends Error {
    readonly status: number;
    readonly body: string;
    constructor(message: string, status: number, body: string);
}
export declare class SuplaTokenError extends Error {
    constructor(message: string);
}
export declare class SuplaClient {
    private readonly token;
    private readonly baseUrl;
    constructor(token: string, explicitServerUrl?: string);
    static decodeServerFromToken(token: string): string;
    private static normalizeUrl;
    getBaseUrl(): string;
    listElectricityMeters(): Promise<Channel[]>;
    getChannel(id: number): Promise<Channel>;
    private request;
}
