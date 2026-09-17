import type { API, Logging, PlatformAccessory } from 'homebridge';
import type { EveCharacteristicSet } from './eveCharacteristics';
import type { Channel } from './suplaClient';
export type AccessoryKind = 'combined' | 'phase';
export interface AccessoryContext {
    channelId: number;
    kind: AccessoryKind;
    phaseNumber?: 1 | 2 | 3;
    /** Override display name for this accessory (e.g. user-supplied phase label). */
    customLabel?: string;
    /** Combined mode only: phases whose values are summed / averaged. Undefined = all. */
    enabledPhases?: number[];
}
export declare class MeterAccessory {
    private readonly api;
    private readonly log;
    private readonly accessory;
    private readonly eve;
    private readonly outlet;
    private readonly historyService;
    private lastTotalEnergy;
    private offlineWarned;
    constructor(api: API, log: Logging, accessory: PlatformAccessory<AccessoryContext>, eve: EveCharacteristicSet);
    static serialFor(ctx: AccessoryContext): string;
    static uuidSeedFor(ctx: AccessoryContext): string;
    static displayNameFor(channel: Channel, ctx: AccessoryContext): string;
    private ensureCharacteristic;
    beat(channel: Channel): void;
    private computeReading;
}
