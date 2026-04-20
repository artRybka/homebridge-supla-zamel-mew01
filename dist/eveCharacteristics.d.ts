import type { API, Characteristic, WithUUID } from 'homebridge';
export type EveCharacteristicCtor = WithUUID<typeof Characteristic> & WithUUID<new () => Characteristic>;
export interface EveCharacteristicSet {
    Voltage: EveCharacteristicCtor;
    ElectricCurrent: EveCharacteristicCtor;
    CurrentPower: EveCharacteristicCtor;
    TotalConsumption: EveCharacteristicCtor;
}
export declare const EVE_UUID: {
    readonly Voltage: "E863F10A-079E-48FF-8F27-9C2605A29F52";
    readonly ElectricCurrent: "E863F126-079E-48FF-8F27-9C2605A29F52";
    readonly CurrentPower: "E863F10D-079E-48FF-8F27-9C2605A29F52";
    readonly TotalConsumption: "E863F10C-079E-48FF-8F27-9C2605A29F52";
};
export declare function buildEveCharacteristics(api: API): EveCharacteristicSet;
