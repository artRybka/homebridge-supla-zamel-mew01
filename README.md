# homebridge-supla-mew01

Homebridge platform plugin that exposes **Zamel MEW-01 / MEW-01 LITE / LEW-01**
energy meters from **Supla Cloud** as HomeKit accessories with live power,
voltage, current, and accumulated energy.

---

## ⚠️ Energy data is visible only in Eve for HomeKit

Apple Home does **not** display power or energy characteristics natively. The
plugin uses Elgato Eve custom characteristics (UUIDs `E863F1…`) plus
`fakegato-history`, so charts and live values appear in the free
**[Eve for HomeKit](https://apps.apple.com/app/eve-for-homekit/id917695792)**
app — not in Apple Home.

This is an Apple platform limitation, not a plugin bug. The accessory still
shows up in Apple Home as an outlet (always "on") with no values.

---

## Features

- Auto-discovers all electricity meters (`functionId=310`) on your Supla account
- Detects the target Supla server automatically from the access token
- One poll per platform — no duplicate API traffic when you have multiple meters
- Two presentation modes:
  - **Combined** (default): one accessory per meter, summing all phases
  - **Per phase**: separate accessory for each phase (L1, L2, L3) with its own history
- Resilient polling: API errors are logged but never crash Homebridge
- All configuration through **Homebridge Config UI X** — `config.json` is never
  edited by hand

---

## Installation

```bash
npm install -g homebridge-supla-mew01
```

Or from the Homebridge UI plugin tab, search for **Supla MEW-01**.

---

## Setup

### 1. Generate a Personal Access Token in Supla Cloud

1. Sign in to [https://cloud.supla.org](https://cloud.supla.org)
2. Go to **My account → Integrations → Personal access tokens**
3. Click **Create token** and grant the **`channels_r`** scope
4. Copy the full token — it has the format `{tokenHex}.{base64Url}`

### 2. Configure the plugin

1. Open **Homebridge Config UI X** and click the gear icon next to *Supla MEW-01*
2. Paste the token into **Supla Personal Access Token**
3. Click **Test connection & detect meters** — the plugin decodes the server URL
   from the token and asks Supla Cloud for your meters
4. Tick the meters you want to expose, choose presentation mode, and **Save**

The plugin handles the rest. Restart is not required — Homebridge picks the new
config up automatically (or after the bridge is restarted, depending on your
Config UI X version).

### 3. View the data in Eve for HomeKit

1. Install [Eve for HomeKit](https://apps.apple.com/app/eve-for-homekit/id917695792)
2. The MEW-01 meter shows up in **At a Glance** as a Power tile
3. Tap it to see voltage, current, power, and the accumulated kWh
4. Power history starts populating after ~15–20 minutes of polling

---

## Configuration reference

Filled in by the UI. Listed here only for reference — do not edit by hand.

| Field | Type | Default | Notes |
|---|---|---|---|
| `accessToken` | string | — | Supla PAT (`channels_r` scope) |
| `serverUrl` | string | derived | Auto-decoded from the token |
| `pollInterval` | integer | `30` | Seconds; minimum `10` |
| `mode` | `combined` \| `perPhase` | `combined` | Presentation mode |
| `channels` | `int[]` | auto | Specific Supla channel IDs to expose |

---

## Troubleshooting

**"Token rejected" toast in the UI**
The token is missing the `channels_r` scope or has expired. Generate a fresh
one in Supla Cloud and try again.

**"Decoded server URL looks invalid"**
The token does not include the standard `{token}.{base64(serverUrl)}` suffix.
This shouldn't happen with PATs generated from `cloud.supla.org`.

**No meters detected**
Make sure the meter is paired with your Supla account and that its function
in Supla is set to *Electricity meter* (Supla function ID `310`).

**Numbers don't change in Eve**
Check the Homebridge log. Polling errors are reported as `warn`. Default
poll interval is 30 s — increase up to 600 s if you hit Supla rate limits.

---

## Developer notes

```bash
git clone https://github.com/artrybka/homebridge-supla-zamel-mew01
cd homebridge-supla-zamel-mew01
npm install
npm run build

# Quick smoke test against a real Supla account:
SUPLA_TOKEN=xxxx.yyyy npm run probe

# Watch + rebuild during development:
npm run watch
```

Run inside Homebridge as a **child bridge** during development so failed
restarts don't take the whole bridge down.

---

## License

MIT — see [LICENSE](LICENSE).
