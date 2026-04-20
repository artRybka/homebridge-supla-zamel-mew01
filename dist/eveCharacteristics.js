"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EVE_UUID = void 0;
exports.buildEveCharacteristics = buildEveCharacteristics;
exports.EVE_UUID = {
    Voltage: 'E863F10A-079E-48FF-8F27-9C2605A29F52',
    ElectricCurrent: 'E863F126-079E-48FF-8F27-9C2605A29F52',
    CurrentPower: 'E863F10D-079E-48FF-8F27-9C2605A29F52',
    TotalConsumption: 'E863F10C-079E-48FF-8F27-9C2605A29F52',
};
function buildEveCharacteristics(api) {
    const Base = api.hap.Characteristic;
    const { Formats, Perms } = api.hap;
    class EveVoltage extends Base {
        static UUID = exports.EVE_UUID.Voltage;
        constructor() {
            super('Voltage', EveVoltage.UUID, {
                format: "float" /* Formats.FLOAT */,
                unit: 'V',
                minValue: 0,
                maxValue: 400,
                minStep: 0.1,
                perms: ["pr" /* Perms.PAIRED_READ */, "ev" /* Perms.NOTIFY */],
            });
            this.value = 0;
        }
    }
    class EveElectricCurrent extends Base {
        static UUID = exports.EVE_UUID.ElectricCurrent;
        constructor() {
            super('Electric Current', EveElectricCurrent.UUID, {
                format: "float" /* Formats.FLOAT */,
                unit: 'A',
                minValue: 0,
                maxValue: 1000,
                minStep: 0.01,
                perms: ["pr" /* Perms.PAIRED_READ */, "ev" /* Perms.NOTIFY */],
            });
            this.value = 0;
        }
    }
    class EveCurrentPower extends Base {
        static UUID = exports.EVE_UUID.CurrentPower;
        constructor() {
            super('Consumption', EveCurrentPower.UUID, {
                format: "float" /* Formats.FLOAT */,
                unit: 'W',
                minValue: 0,
                maxValue: 65535,
                minStep: 0.1,
                perms: ["pr" /* Perms.PAIRED_READ */, "ev" /* Perms.NOTIFY */],
            });
            this.value = 0;
        }
    }
    class EveTotalConsumption extends Base {
        static UUID = exports.EVE_UUID.TotalConsumption;
        constructor() {
            super('Total Consumption', EveTotalConsumption.UUID, {
                format: "float" /* Formats.FLOAT */,
                unit: 'kWh',
                minValue: 0,
                maxValue: 1_000_000_000,
                minStep: 0.001,
                perms: ["pr" /* Perms.PAIRED_READ */, "ev" /* Perms.NOTIFY */],
            });
            this.value = 0;
        }
    }
    return {
        Voltage: EveVoltage,
        ElectricCurrent: EveElectricCurrent,
        CurrentPower: EveCurrentPower,
        TotalConsumption: EveTotalConsumption,
    };
}
//# sourceMappingURL=eveCharacteristics.js.map