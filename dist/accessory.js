"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MeterAccessory = void 0;
const fakegato_history_1 = __importDefault(require("fakegato-history"));
const HISTORY_DIR_NAME = 'supla-mew01-history';
class MeterAccessory {
    api;
    log;
    accessory;
    eve;
    outlet;
    historyService;
    lastTotalEnergy = null;
    offlineWarned = false;
    constructor(api, log, accessory, eve) {
        this.api = api;
        this.log = log;
        this.accessory = accessory;
        this.eve = eve;
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
        const FakeGatoHistoryService = (0, fakegato_history_1.default)(api);
        this.historyService = new FakeGatoHistoryService('energy', accessory, {
            storage: 'fs',
            path: `${api.user.storagePath()}/${HISTORY_DIR_NAME}`,
        });
    }
    static serialFor(ctx) {
        return ctx.kind === 'phase'
            ? `MEW01-${ctx.channelId}-L${ctx.phaseNumber}`
            : `MEW01-${ctx.channelId}`;
    }
    static uuidSeedFor(ctx) {
        return ctx.kind === 'phase'
            ? `homebridge-supla-mew01:channel:${ctx.channelId}:phase:${ctx.phaseNumber}`
            : `homebridge-supla-mew01:channel:${ctx.channelId}:combined`;
    }
    static displayNameFor(channel, ctx) {
        const base = (channel.caption && channel.caption.trim()) || `Meter ${channel.id}`;
        return ctx.kind === 'phase' ? `${base} L${ctx.phaseNumber}` : base;
    }
    ensureCharacteristic(ctor) {
        if (!this.outlet.testCharacteristic(ctor)) {
            this.outlet.addCharacteristic(ctor);
        }
    }
    beat(channel) {
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
        if (!reading)
            return;
        this.outlet.updateCharacteristic(this.eve.CurrentPower, Math.max(0, reading.power));
        this.outlet.updateCharacteristic(this.eve.Voltage, reading.voltage);
        this.outlet.updateCharacteristic(this.eve.ElectricCurrent, reading.current);
        this.outlet.updateCharacteristic(this.eve.TotalConsumption, reading.totalEnergy);
        this.outlet.updateCharacteristic(this.api.hap.Characteristic.OutletInUse, reading.power > 1);
        if (this.lastTotalEnergy !== null && reading.totalEnergy < this.lastTotalEnergy) {
            this.log.info(`[${this.accessory.displayName}] energy counter reset detected — skipping history delta.`);
        }
        else {
            this.historyService.addEntry({
                time: Math.floor(Date.now() / 1000),
                power: Math.max(0, reading.power),
            });
        }
        this.lastTotalEnergy = reading.totalEnergy;
    }
    computeReading(phases) {
        if (phases.length === 0)
            return null;
        const ctx = this.accessory.context;
        if (ctx.kind === 'phase') {
            const phase = phases.find((p) => p.number === ctx.phaseNumber);
            if (!phase)
                return null;
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
exports.MeterAccessory = MeterAccessory;
//# sourceMappingURL=accessory.js.map