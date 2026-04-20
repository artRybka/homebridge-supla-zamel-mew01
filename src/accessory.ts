import fakegatoHistoryFactory from 'fakegato-history';
import type { API, Logging, PlatformAccessory, Service } from 'homebridge';

import type { EveCharacteristicCtor, EveCharacteristicSet } from './eveCharacteristics';
import type { Channel, Phase } from './suplaClient';

export type AccessoryKind = 'combined' | 'phase';

export interface AccessoryContext {
  channelId: number;
  kind: AccessoryKind;
  phaseNumber?: 1 | 2 | 3;
}

interface MeterReading {
  power: number;
  voltage: number;
  current: number;
  totalEnergy: number;
}

const HISTORY_DIR_NAME = 'supla-mew01-history';

export class MeterAccessory {
  private readonly outlet: Service;
  private readonly historyService: InstanceType<ReturnType<typeof fakegatoHistoryFactory>>;
  private lastTotalEnergy: number | null = null;
  private offlineWarned = false;

  constructor(
    private readonly api: API,
    private readonly log: Logging,
    private readonly accessory: PlatformAccessory<AccessoryContext>,
    private readonly eve: EveCharacteristicSet,
  ) {
    const ctx = accessory.context;
    const info = accessory.getService(api.hap.Service.AccessoryInformation)
      ?? accessory.addService(api.hap.Service.AccessoryInformation);

    info
      .setCharacteristic(api.hap.Characteristic.Manufacturer, 'Zamel')
      .setCharacteristic(api.hap.Characteristic.Model, ctx.kind === 'phase' ? 'MEW-01 (per phase)' : 'MEW-01')
      .setCharacteristic(api.hap.Characteristic.SerialNumber, MeterAccessory.serialFor(ctx))
      .setCharacteristic(api.hap.Characteristic.FirmwareRevision, '0.1.0');

    this.outlet = accessory.getService(api.hap.Service.Outlet)
      ?? accessory.addService(api.hap.Service.Outlet, accessory.displayName);

    this.outlet.getCharacteristic(api.hap.Characteristic.On)
      .onGet(() => true)
      .onSet(() => {
        // Energy meter — cannot actually be switched. Force back to "on".
        setTimeout(() => {
          this.outlet.updateCharacteristic(api.hap.Characteristic.On, true);
        }, 50);
      });

    this.outlet.getCharacteristic(api.hap.Characteristic.OutletInUse)
      .onGet(() => {
        const v = this.outlet.getCharacteristic(eve.CurrentPower).value;
        return typeof v === 'number' && v > 1;
      });

    this.ensureCharacteristic(eve.Voltage);
    this.ensureCharacteristic(eve.ElectricCurrent);
    this.ensureCharacteristic(eve.CurrentPower);
    this.ensureCharacteristic(eve.TotalConsumption);

    const FakeGatoHistoryService = fakegatoHistoryFactory(api);
    this.historyService = new FakeGatoHistoryService('energy', accessory, {
      storage: 'fs',
      path: `${api.user.storagePath()}/${HISTORY_DIR_NAME}`,
    });
  }

  static serialFor(ctx: AccessoryContext): string {
    return ctx.kind === 'phase'
      ? `MEW01-${ctx.channelId}-L${ctx.phaseNumber}`
      : `MEW01-${ctx.channelId}`;
  }

  static uuidSeedFor(ctx: AccessoryContext): string {
    return ctx.kind === 'phase'
      ? `homebridge-supla-mew01:channel:${ctx.channelId}:phase:${ctx.phaseNumber}`
      : `homebridge-supla-mew01:channel:${ctx.channelId}:combined`;
  }

  static displayNameFor(channel: Channel, ctx: AccessoryContext): string {
    const base = (channel.caption && channel.caption.trim()) || `Meter ${channel.id}`;
    return ctx.kind === 'phase' ? `${base} L${ctx.phaseNumber}` : base;
  }

  private ensureCharacteristic(ctor: EveCharacteristicCtor): void {
    if (!this.outlet.testCharacteristic(ctor)) {
      this.outlet.addCharacteristic(ctor);
    }
  }

  beat(channel: Channel): void {
    const connected = channel.state?.connected ?? false;
    if (!connected) {
      if (!this.offlineWarned) {
        this.log.warn(`[${this.accessory.displayName}] device offline — keeping last values.`);
        this.offlineWarned = true;
      }
      return;
    }
    this.offlineWarned = false;

    const phases = channel.state?.phases ?? [];
    const reading = this.computeReading(phases);
    if (!reading) return;

    this.outlet.updateCharacteristic(this.eve.CurrentPower, Math.max(0, reading.power));
    this.outlet.updateCharacteristic(this.eve.Voltage, reading.voltage);
    this.outlet.updateCharacteristic(this.eve.ElectricCurrent, reading.current);
    this.outlet.updateCharacteristic(this.eve.TotalConsumption, reading.totalEnergy);
    this.outlet.updateCharacteristic(this.api.hap.Characteristic.OutletInUse, reading.power > 1);

    if (this.lastTotalEnergy !== null && reading.totalEnergy < this.lastTotalEnergy) {
      this.log.info(`[${this.accessory.displayName}] energy counter reset detected — skipping history delta.`);
    } else {
      this.historyService.addEntry({
        time: Math.floor(Date.now() / 1000),
        power: Math.max(0, reading.power),
      });
    }
    this.lastTotalEnergy = reading.totalEnergy;
  }

  private computeReading(phases: Phase[]): MeterReading | null {
    if (phases.length === 0) return null;

    const ctx = this.accessory.context;
    if (ctx.kind === 'phase') {
      const phase = phases.find((p) => p.number === ctx.phaseNumber);
      if (!phase) return null;
      return {
        power: phase.powerActive,
        voltage: phase.voltage,
        current: phase.current,
        totalEnergy: phase.totalForwardActiveEnergy,
      };
    }

    const power = phases.reduce((s, p) => s + p.powerActive, 0);
    const current = phases.reduce((s, p) => s + p.current, 0);
    const totalEnergy = phases.reduce((s, p) => s + p.totalForwardActiveEnergy, 0);
    const voltage = phases.reduce((s, p) => s + p.voltage, 0) / phases.length;
    return { power, voltage, current, totalEnergy };
  }
}
