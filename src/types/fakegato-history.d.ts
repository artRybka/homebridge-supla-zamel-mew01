declare module 'fakegato-history' {
  import type { API, PlatformAccessory } from 'homebridge';

  interface FakeGatoOptions {
    storage?: 'fs' | 'googleDrive';
    path?: string;
    disableTimer?: boolean;
    minutes?: number;
  }

  interface FakeGatoEntry {
    time: number;
    power?: number;
    voltage?: number;
    current?: number;
    [key: string]: number | undefined;
  }

  type FakeGatoHistoryServiceType = 'energy' | 'weather' | 'room' | 'door' | 'motion' | 'thermo' | 'aqua' | 'custom';

  class FakeGatoHistoryService {
    constructor(type: FakeGatoHistoryServiceType, accessory: PlatformAccessory, options?: FakeGatoOptions);
    addEntry(entry: FakeGatoEntry): void;
  }

  function factory(api: API): typeof FakeGatoHistoryService;
  export = factory;
}
