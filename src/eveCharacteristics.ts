import type { API, Characteristic, WithUUID } from 'homebridge';

// hap-nodejs exposes two type shapes for characteristic constructors —
// `typeof Characteristic` (3-arg) used by addCharacteristic, and
// `new () => Characteristic` (zero-arg) used by getCharacteristic /
// updateCharacteristic. Custom subclasses satisfy both at runtime, but
// TypeScript needs an explicit intersection.
export type EveCharacteristicCtor =
  WithUUID<typeof Characteristic> & WithUUID<new () => Characteristic>;

export interface EveCharacteristicSet {
  Voltage: EveCharacteristicCtor;
  ElectricCurrent: EveCharacteristicCtor;
  CurrentPower: EveCharacteristicCtor;
  TotalConsumption: EveCharacteristicCtor;
}

export const EVE_UUID = {
  Voltage: 'E863F10A-079E-48FF-8F27-9C2605A29F52',
  ElectricCurrent: 'E863F126-079E-48FF-8F27-9C2605A29F52',
  CurrentPower: 'E863F10D-079E-48FF-8F27-9C2605A29F52',
  TotalConsumption: 'E863F10C-079E-48FF-8F27-9C2605A29F52',
} as const;

export function buildEveCharacteristics(api: API): EveCharacteristicSet {
  const Base = api.hap.Characteristic;
  const { Formats, Perms } = api.hap;

  class EveVoltage extends Base {
    static readonly UUID = EVE_UUID.Voltage;
    constructor() {
      super('Voltage', EveVoltage.UUID, {
        format: Formats.FLOAT,
        unit: 'V',
        minValue: 0,
        maxValue: 400,
        minStep: 0.1,
        perms: [Perms.PAIRED_READ, Perms.NOTIFY],
      });
      this.value = 0;
    }
  }

  class EveElectricCurrent extends Base {
    static readonly UUID = EVE_UUID.ElectricCurrent;
    constructor() {
      super('Electric Current', EveElectricCurrent.UUID, {
        format: Formats.FLOAT,
        unit: 'A',
        minValue: 0,
        maxValue: 1000,
        minStep: 0.01,
        perms: [Perms.PAIRED_READ, Perms.NOTIFY],
      });
      this.value = 0;
    }
  }

  class EveCurrentPower extends Base {
    static readonly UUID = EVE_UUID.CurrentPower;
    constructor() {
      super('Consumption', EveCurrentPower.UUID, {
        format: Formats.FLOAT,
        unit: 'W',
        minValue: 0,
        maxValue: 65535,
        minStep: 0.1,
        perms: [Perms.PAIRED_READ, Perms.NOTIFY],
      });
      this.value = 0;
    }
  }

  class EveTotalConsumption extends Base {
    static readonly UUID = EVE_UUID.TotalConsumption;
    constructor() {
      super('Total Consumption', EveTotalConsumption.UUID, {
        format: Formats.FLOAT,
        unit: 'kWh',
        minValue: 0,
        maxValue: 1_000_000_000,
        minStep: 0.001,
        perms: [Perms.PAIRED_READ, Perms.NOTIFY],
      });
      this.value = 0;
    }
  }

  return {
    Voltage: EveVoltage as unknown as EveCharacteristicCtor,
    ElectricCurrent: EveElectricCurrent as unknown as EveCharacteristicCtor,
    CurrentPower: EveCurrentPower as unknown as EveCharacteristicCtor,
    TotalConsumption: EveTotalConsumption as unknown as EveCharacteristicCtor,
  };
}
