# Homebridge Plugin: Zamel MEW-01 (Supla Cloud) — Specyfikacja dla Claude Code

## 1. Cel projektu

Zbudować plugin Homebridge prezentujący dane z licznika energii **Zamel MEW-01** (1-fazowego lub 3-fazowego) pobierane z chmury **Supla** przez REST API. Plugin ma wystawiać dane do HomeKit w taki sposób, aby były widoczne w aplikacji **Eve for HomeKit** (napięcie, prąd, moc czynna, energia skumulowana — z wykresami historycznymi).

**Nazwa pakietu:** `homebridge-supla-mew01`
**Język:** TypeScript
**Typ pluginu:** Platform plugin (obsługa wielu kanałów/liczników)

---

## 2. Ważne ograniczenia HomeKit (PRZECZYTAJ PRZED STARTEM)

- Aplikacja **Apple Home nie wyświetla** natywnie danych o zużyciu energii ani mocy. Charakterystyki energetyczne są **custom Eve** (UUID zaczynające się od `E863F1...`).
- Dane (W, V, A, kWh) i wykresy historyczne będą widoczne **wyłącznie w aplikacji Eve for HomeKit** (darmowa, App Store).
- To nie jest wada pluginu — to ograniczenie platformy. Udokumentować to w README jako pierwszą sekcję.

---

## 3. Informacje o urządzeniu MEW-01

- Licznik energii WiFi firmy Zamel (seria Supla), wersje: MEW-01 (3-fazowy), MEW-01 LITE (3F z anteną wewnętrzną), LEW-01 (1-fazowy)
- Dane wysyłane do chmury Supla, dostępne przez REST API oraz (opcjonalnie) lokalny MQTT
- Function ID w Supla dla tego licznika: **`310` (ELECTRICITYMETER)**
- Type ID: `5000`

**Pola zwracane przez API per faza** (tablica `phases`):
| Pole | Jednostka | Znaczenie |
|---|---|---|
| `number` | — | numer fazy (1, 2, 3) |
| `voltage` | V | napięcie |
| `current` | A | prąd |
| `frequency` | Hz | częstotliwość |
| `powerActive` | W | moc czynna |
| `powerReactive` | var | moc bierna |
| `powerApparent` | VA | moc pozorna |
| `powerFactor` | — | cos φ |
| `phaseAngle` | ° | kąt fazowy |
| `totalForwardActiveEnergy` | kWh | energia pobrana z sieci (skumulowana) |
| `totalReverseActiveEnergy` | kWh | energia oddana do sieci (dla PV) |
| `totalForwardReactiveEnergy` | kvarh | energia bierna pobrana |
| `totalReverseReactiveEnergy` | kvarh | energia bierna oddana |

---

## 4. Supla Cloud REST API — podstawy

### 4.1 Uwierzytelnianie — Personal Access Token (PAT)

Najprostszy sposób dla DIY. Użytkownik wygeneruje token w panelu Supla:
`Moje konto → Integracje → Tokeny dostępu osobistego`

**Wymagany zakres (scope):** `channels_r` (odczyt kanałów). Do logów historycznych wystarczy ten sam scope.

### 4.2 Format tokenu — WAŻNE

PAT ma format: `{token_hex}.{base64_url_docelowego_serwera}`

Przykład:
```
MjJjY2M2ZGZjZWZmZmUwZTM2ZDJlOTA1MDcxMTE4YjYwNTk5ODQ4ZDZmZjQyYTM0NzY3ZDBhODQzOTBmNDkwZg.aHR0cHM6Ly9zdnIzLnN1cGxhLm9yZw==
```

Druga część po kropce to **base64-encoded URL serwera docelowego** (np. `https://svr3.supla.org`). Plugin musi:
1. Rozdzielić token po kropce
2. Zdekodować base64 drugiej części → otrzymamy URL serwera (`svrXX.supla.org`)
3. Wszystkie requesty kierować **bezpośrednio na ten URL**, nie na `cloud.supla.org` (broker zwróci błąd)

Alternatywnie: dać userowi możliwość ręcznego podania `serverUrl` w configu (szybszy fallback jeśli dekodowanie zawiedzie).

### 4.3 Endpointy

Base URL: `https://{serverUrl}/api/v3/` (aktualna wersja to v3; v2.3 wciąż działa)

**Autoryzacja:** nagłówek `Authorization: Bearer {token}`

**Lista kanałów użytkownika:**
```
GET /api/v3/channels?include=state
```
Zwraca tablicę kanałów. Filtrować po `functionId === 310` (licznik energii) lub po `function.name === "ELECTRICITYMETER"`.

**Pojedynczy kanał ze stanem bieżącym:**
```
GET /api/v3/channels/{id}?include=state
```

Struktura odpowiedzi:
```json
{
  "id": 123456,
  "functionId": 310,
  "function": { "name": "ELECTRICITYMETER" },
  "caption": "Licznik główny",
  "state": {
    "connected": true,
    "phases": [
      {
        "number": 1,
        "voltage": 237.43,
        "current": 0.074,
        "frequency": 50,
        "powerActive": 3.20,
        "powerReactive": -16.79,
        "powerApparent": 17.34,
        "powerFactor": 0.154,
        "totalForwardActiveEnergy": 55.0893,
        "totalReverseActiveEnergy": 0.00908
      },
      { "number": 2, ... },
      { "number": 3, ... }
    ]
  }
}
```

**Logi historyczne (opcjonalnie, do zasilenia fakegato przy starcie):**
```
GET /api/v3/channels/{id}/measurement-logs?order=ASC&limit=1000&afterTimestamp={unix}
```

### 4.4 Limity API

Supla nie publikuje twardych limitów dla PAT, ale **nie pollować częściej niż co 10 s**. Domyślnie sugeruj **30 s**. MQTT publikuje co 5 s — gdyby userowi na tym zależało, to dodatkowa ścieżka na później.

---

## 5. Architektura pluginu

### 5.1 Stack

- **TypeScript** (strict mode)
- Template: [homebridge-plugin-template](https://github.com/homebridge/homebridge-plugin-template)
- Node `>=18`
- Homebridge `>=1.8.0` lub `>=2.0.0-beta` (deklaratywnie wspieraj oba)
- Dependencies:
  - `axios` lub natywny `fetch` (Node 18+) do HTTP
  - `fakegato-history` (do historii w Eve)
  - `homebridge-lib` (opcjonalnie — `ebaauw/homebridge-lib` upraszcza custom characteristics; można też ręcznie)

### 5.2 Struktura plików

```
homebridge-supla-mew01/
├── src/
│   ├── index.ts              # entry point (registerPlatform)
│   ├── platform.ts           # klasa SuplaMew01Platform
│   ├── suplaClient.ts        # obsługa Supla API (auth, fetch, parse)
│   ├── accessory.ts          # MeterAccessory — budowa serwisów HomeKit
│   ├── eveCharacteristics.ts # definicje custom Eve UUIDs
│   └── settings.ts           # stałe (PLATFORM_NAME, PLUGIN_NAME)
├── config.schema.json        # schema dla Config UI X
├── package.json
├── tsconfig.json
├── README.md
└── LICENSE
```

### 5.3 Poller — jeden request na wiele akcesoriów

Kluczowa decyzja architektoniczna: **jeden timer w platformie** pobiera listę kanałów (lub każdy kanał z osobna, jeśli user skonfigurował konkretne ID) i rozgłasza dane do akcesoriów. Akcesoria nie pollują same.

Wzorzec: metoda `beat()` w każdym akcesorium, wołana przez platformę po każdym udanym fetchu (patrz: plugin `homebridge-homewizard-power-consumption` jako referencja wzorca).

---

## 6. Mapowanie danych na HomeKit / Eve

### 6.1 Wybór modelu akcesorium

Dwa sensowne podejścia — **zaimplementuj oba, konfigurowalne przez config**:

**Tryb A — jedno akcesorium zbiorcze (domyślny):**
- Jeden `Outlet Service` z sumarycznymi wartościami 3 faz
- `Power = suma powerActive`
- `Voltage = średnia z faz` (lub faza 1 — user wybiera)
- `Current = suma current`
- `TotalConsumption = suma totalForwardActiveEnergy`

**Tryb B — akcesorium per faza:**
- 3 oddzielne akcesoria (L1, L2, L3) — każdy jako osobny Outlet
- Pozwala na szczegółowe automatyki per faza
- Każda faza ma osobną historię Eve (unikalny `SerialNumber`)

### 6.2 Eve custom characteristics

```ts
// eveCharacteristics.ts — UUIDs ustalone przez Elgato Eve
export const EVE_UUID = {
  Voltage:           'E863F10A-079E-48FF-8F27-9C2605A29F52', // V
  ElectricCurrent:   'E863F126-079E-48FF-8F27-9C2605A29F52', // A
  CurrentPower:      'E863F10D-079E-48FF-8F27-9C2605A29F52', // W
  TotalConsumption:  'E863F10C-079E-48FF-8F27-9C2605A29F52', // kWh
  ResetTotal:        'E863F112-079E-48FF-8F27-9C2605A29F52', // reset counter
};
```

Definicja charakterystyki (wzór — do powtórzenia dla każdej):
```ts
class EveCurrentPower extends Characteristic {
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
    this.value = this.getDefaultValue();
  }
}
```

Dodaj charakterystyki do `Service.Outlet`:
```ts
const outlet = accessory.getService(Service.Outlet) ?? accessory.addService(Service.Outlet);
outlet.getCharacteristic(Characteristic.On).onGet(() => true); // zawsze "włączony"
outlet.getCharacteristic(Characteristic.OutletInUse).onGet(() => currentPower > 1);

if (!outlet.testCharacteristic(EveCurrentPower)) outlet.addCharacteristic(EveCurrentPower);
// ... analogicznie dla Voltage, ElectricCurrent, TotalConsumption
```

### 6.3 Historia — fakegato-history

```ts
import fakegatoHistoryFactory from 'fakegato-history';
const FakeGatoHistoryService = fakegatoHistoryFactory(api);

this.historyService = new FakeGatoHistoryService('energy', accessory, {
  storage: 'fs',
  path: api.user.storagePath() + '/supla-mew01-history',
});

// W każdym cyklu pollingu:
this.historyService.addEntry({
  time: Math.floor(Date.now() / 1000),
  power: currentPower,
});
```

**Ważne:** `SerialNumber` w `AccessoryInformation` musi być unikalny per akcesorium (np. `MEW01-{channelId}-phase{N}`), inaczej Eve scali historie.

---

## 7. Konfiguracja (`config.schema.json`)

```json
{
  "pluginAlias": "SuplaMew01",
  "pluginType": "platform",
  "singular": false,
  "schema": {
    "type": "object",
    "properties": {
      "name": {
        "title": "Nazwa platformy",
        "type": "string",
        "default": "Supla MEW-01",
        "required": true
      },
      "accessToken": {
        "title": "Supla Personal Access Token",
        "type": "string",
        "required": true,
        "description": "Wygeneruj w Supla Cloud: Moje konto → Integracje → Tokeny dostępu osobistego. Wymagany scope: channels_r"
      },
      "serverUrl": {
        "title": "URL serwera Supla (opcjonalne)",
        "type": "string",
        "placeholder": "https://svr3.supla.org",
        "description": "Pozostaw puste — plugin odczyta z tokenu. Wypełnij tylko jeśli dekodowanie zawodzi."
      },
      "pollInterval": {
        "title": "Interwał odpytywania (sekundy)",
        "type": "integer",
        "default": 30,
        "minimum": 10,
        "maximum": 600
      },
      "mode": {
        "title": "Tryb prezentacji",
        "type": "string",
        "oneOf": [
          { "title": "Jedno akcesorium (suma 3 faz)", "enum": ["combined"] },
          { "title": "Osobne akcesorium per faza", "enum": ["perPhase"] }
        ],
        "default": "combined"
      },
      "channels": {
        "title": "ID kanałów do monitorowania (opcjonalne)",
        "type": "array",
        "items": { "type": "integer" },
        "description": "Pozostaw puste, aby auto-wykryć wszystkie liczniki (functionId=310)"
      }
    }
  }
}
```

### 7.1 Custom UI dla Config UI X — WYMAGANE

**Zasada nadrzędna:** cała konfiguracja pluginu odbywa się **wyłącznie przez Config UI X**. User nigdy nie edytuje `config.json` ręcznie, nie wkleja ID kanałów, nie szuka URL serwera. README wspomina tylko o interfejsie.

Plugin musi zawierać **Custom UI** (ponad samym `config.schema.json`) — dokumentacja: https://github.com/homebridge/plugin-ui-utils

Struktura katalogu:
```
homebridge-ui/
├── public/
│   ├── index.html       # formularz z przyciskiem "Testuj połączenie" i listą kanałów
│   └── script.js        # komunikacja z server.js przez homebridge.request()
└── server.js            # serwerowa strona — woła Supla API tokenem z formularza
```

**Przepływ UX:**
1. User otwiera ustawienia pluginu w Config UI X
2. Wkleja PAT w pole `accessToken`
3. Klika **„Testuj połączenie i wykryj liczniki"**
4. `server.js` dekoduje token, pobiera `/channels?include=state&function=310`, zwraca listę
5. UI pokazuje tabelę wykrytych liczników: `caption | channelId | liczba faz | online?`
6. User zaznacza checkboxami które chce dodać + wybiera tryb (combined / perPhase) per licznik
7. Klik **„Zapisz"** — UI wypełnia `config.json` w tle, user nie widzi JSON-a

**Szkic `homebridge-ui/server.js`:**
```js
const { HomebridgePluginUiServer } = require('@homebridge/plugin-ui-utils');

class UiServer extends HomebridgePluginUiServer {
  constructor() {
    super();
    this.onRequest('/test-connection', async ({ accessToken, serverUrl }) => {
      const { SuplaClient } = require('../dist/suplaClient');
      const client = new SuplaClient(accessToken, serverUrl);
      const meters = await client.listElectricityMeters();
      return {
        success: true,
        serverUrl: client.getBaseUrl(),
        meters: meters.map(m => ({
          id: m.id,
          caption: m.caption ?? `Licznik ${m.id}`,
          phaseCount: m.state?.phases?.length ?? 0,
          connected: m.state?.connected ?? false,
        })),
      };
    });
    this.ready();
  }
}
new UiServer();
```

**Szkic wywołania z `public/script.js`:**
```js
document.getElementById('testBtn').addEventListener('click', async () => {
  const accessToken = document.getElementById('token').value;
  try {
    const result = await homebridge.request('/test-connection', { accessToken });
    renderMeterList(result.meters);
    homebridge.toast.success(`Znaleziono ${result.meters.length} liczników`);
  } catch (e) {
    homebridge.toast.error(e.message);
  }
});
```

**Dodaj do `package.json`:**
```json
{
  "dependencies": {
    "@homebridge/plugin-ui-utils": "^2.0.0"
  }
}
```

**Walidacje w UI (zanim dojdzie do zapisu):**
- Pusty token → disable przycisku Test
- Token bez kropki → toast „Nieprawidłowy format tokenu"
- Błąd 401 z Supla → toast „Token odrzucony — sprawdź scope `channels_r`"
- Zero wykrytych liczników → toast „Nie znaleziono liczników MEW-01 / LEW-01 na tym koncie"

**Zmiana w `config.schema.json`:**
Pole `channels` zostaje, ale ukryte przed bezpośrednią edycją (`"condition": { "functionBody": "return false;" }`) — wartość wypełnia Custom UI. Pole `serverUrl` też ukryte (zawsze z tokenu).

---

## 8. SuplaClient — szkic

```ts
// src/suplaClient.ts
export class SuplaClient {
  private baseUrl: string;
  constructor(private token: string, explicitServerUrl?: string) {
    this.baseUrl = explicitServerUrl ?? this.decodeServerFromToken(token);
  }

  private decodeServerFromToken(token: string): string {
    const parts = token.split('.');
    if (parts.length !== 2) {
      throw new Error('Invalid token format — expected "token.base64Url"');
    }
    const decoded = Buffer.from(parts[1], 'base64').toString('utf-8');
    if (!/^https?:\/\//.test(decoded)) {
      throw new Error(`Decoded server URL looks invalid: ${decoded}`);
    }
    return decoded.replace(/\/$/, '');
  }

  async listElectricityMeters(): Promise<Channel[]> {
    const all = await this.request<Channel[]>('/api/v3/channels?include=state');
    return all.filter(c => c.functionId === 310);
  }

  async getChannel(id: number): Promise<Channel> {
    return this.request<Channel>(`/api/v3/channels/${id}?include=state`);
  }

  private async request<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!res.ok) {
      throw new Error(`Supla API ${res.status}: ${await res.text()}`);
    }
    return res.json() as Promise<T>;
  }
}
```

Typy:
```ts
export interface Phase {
  number: 1 | 2 | 3;
  voltage: number;
  current: number;
  frequency: number;
  powerActive: number;
  powerReactive: number;
  powerApparent: number;
  powerFactor: number;
  totalForwardActiveEnergy: number;
  totalReverseActiveEnergy: number;
}
export interface Channel {
  id: number;
  functionId: number;
  caption: string | null;
  state: { connected: boolean; phases: Phase[] };
}
```

---

## 9. Plan implementacji krok po kroku

1. **Setup projektu** — sklonuj `homebridge-plugin-template`, zmień nazwy na `homebridge-supla-mew01`, zainstaluj `axios`/użyj fetch, `fakegato-history`.
2. **SuplaClient** — implementacja + test jednostkowy dekodowania tokenu na znanym przykładzie.
3. **Skrypt CLI do testu** — `npm run probe` uruchamiający `listElectricityMeters()` i wypisujący JSON. Bardzo pomocny przy debugowaniu przed wpięciem w Homebridge.
4. **Platform** — `discoverDevices()` woła `listElectricityMeters()` lub używa konfigurowanej listy `channels`. Tworzy/aktualizuje akcesoria przez `api.registerPlatformAccessories` / `api.updatePlatformAccessories`.
5. **Akcesorium combined** — `Service.Outlet` + 4 custom Eve characteristics + fakegato.
6. **Akcesorium perPhase** — 3 akcesoria, każde z własnym UUID (pochodnym od channelId + phaseNumber) i serialNumber.
7. **Poller** — `setInterval` w platformie, z obsługą błędów (log warn, nie crashuj). Exponential backoff przy błędach autoryzacji.
8. **Config UI X schema** — już zdefiniowana wyżej, dopracuj opisy.
9. **README.md** — z **wyraźnym ostrzeżeniem o Eve app na górze**, instrukcją generowania PAT, screenshotem Eve.
10. **CI** (opcjonalnie) — GitHub Actions: lint + build + `npm publish` on tag.

---

## 10. Obsługa błędów — checklist

- Błędny token / wygasły → log `error`, zatrzymaj polling, nie ubijaj Homebridge
- Brak sieci / timeout → log `warn`, retry w kolejnym cyklu
- `state.connected === false` (urządzenie offline) → utrzymaj ostatnie wartości, ustaw `StatusFault = 1` na serwisie
- Niespójna liczba faz (np. MEW-01 w trybie 1-fazowym) → iteruj po `phases.length`, nie zakładaj 3
- Wartości ujemne `powerActive` (oddawanie do sieci z PV) — w `Eve CurrentPower` ustaw `Math.max(0, power)`, ale zachowaj rzeczywistą wartość w osobnym loggingu / custom field jeśli chcesz
- Reset licznika `totalForwardActiveEnergy` (rzadki, ale możliwy) — nie propaguj ujemnych delt do fakegato

---

## 11. Testowanie

- **Mock API** — zapisz 2-3 przykładowe odpowiedzi JSON z realnego konta Supla (zanonimizowane) do `test/fixtures/`, użyj jako mocków w testach jednostkowych SuplaClient.
- **Dry run** — tryb `--dry-run` w platformie wypisujący, co by zrobił, bez rejestrowania akcesoriów (dla debugowania konfiguracji).
- **Homebridge child bridge** — w developmencie zawsze uruchamiaj plugin jako child bridge, żeby restart nie zabijał całego Homebridge.
- **Test z Eve app** — po parowaniu sprawdź czy:
  - W zakładce „Pokój" widać kafelek z watami
  - W szczegółach akcesorium widać wykres historii (po ~15 min od startu)
  - Reset licznika w Eve działa (opcjonalnie — implementacja `EveResetTotal`)

---

## 12. Rzeczy DO ZROBIENIA w przyszłości (nie w MVP)

- Tryb lokalny przez MQTT (dla userów z własnym brokerem) — bez cloud latency
- Wsparcie dla `LEW-01` (1-fazowy) — powinno działać "za darmo" po poprawnym iterowaniu po `phases`, ale zwalidować
- Auto-odkrywanie tokenem OAuth zamiast PAT (UX lepszy, ale dużo więcej roboty)
- Eksport taryf (day/night) do Eve Cost — Supla API ma pole `currency` w state

---

## 13. Referencje

- Supla REST API docs: https://svr1.supla.org/api-docs/docs.html
- Supla wiki — integrations: https://github.com/SUPLA/supla-cloud/wiki/Integrations
- Plugin referencyjny (Shelly 3EM, podobny use-case): https://github.com/produdegr/homebridge-3em-energy-meter
- Plugin referencyjny (P1 meter, bardzo czysty kod): https://github.com/ebaauw/homebridge-p1
- fakegato-history: https://github.com/simont77/fakegato-history
- Homebridge plugin template: https://github.com/homebridge/homebridge-plugin-template

---

## 14. Kryteria akceptacji MVP

- [ ] Plugin instaluje się przez `npm i -g homebridge-supla-mew01` bez błędów
- [ ] **Cała konfiguracja przez Config UI X — user nigdy nie edytuje `config.json` ręcznie**
- [ ] Custom UI pokazuje przycisk „Testuj połączenie", po kliknięciu wykrywa liczniki i pozwala je zaznaczyć
- [ ] Po wpisaniu PAT auto-wykrywa liczniki MEW-01 w koncie (filtr `functionId=310`)
- [ ] W Apple Home akcesorium pojawia się jako Outlet (zawsze "włączone")
- [ ] W Eve app widać: W, V, A, kWh — zaktualizowane w ciągu pollInterval
- [ ] Po 20 minutach pracy w Eve pojawia się wykres historii mocy
- [ ] Restart Homebridge nie tworzy duplikatów akcesoriów
- [ ] Błąd sieci nie crashuje Homebridge — plugin wraca po ustaniu błędu
