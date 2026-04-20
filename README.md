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

- Supla **OAuth 2.0 authorization code** flow (newer Supla servers such as
  `svr57.supla.org` no longer expose Personal Access Tokens, so OAuth is the
  only supported path)
- Automatic access-token refresh using the stored refresh token — tokens are
  cached on disk and rotated transparently
- Auto-discovers all electricity meters (`functionId=310`) on your Supla account
- One poll per platform — no duplicate API traffic when you have multiple meters
- Two presentation modes:
  - **Combined** (default): one accessory per meter, summing all phases
  - **Per phase**: separate accessory for each phase (L1, L2, L3) with its own history
- All configuration through **Homebridge Config UI X** — `config.json` is never
  edited by hand

---

## Installation

```bash
npm install -g github:artRybka/homebridge-supla-zamel-mew01
```

If Homebridge runs in a Docker container (Synology Container Manager, official
Homebridge image, etc.), install inside the container:

```bash
sudo docker exec homebridge npm install -g github:artRybka/homebridge-supla-zamel-mew01
sudo docker restart homebridge
```

---

## Setup

### 1. Register an OAuth application in Supla Cloud

1. Log in to your Supla server directly, e.g. `https://svrNN.supla.org` (not
   `cloud.supla.org` — it's a broker and may not expose OAuth management).
2. Go to **Integrations → My OAuth apps → Register a new OAuth application**.
3. Set:
   - **Name**: anything, e.g. `Homebridge MEW-01`
   - **Redirect URI**: `http://localhost`
4. Save. Supla shows **Client ID** (a.k.a. *Public ID*) and **Client Secret** —
   copy both.

### 2. Authorize the plugin in Config UI X

1. Open the plugin settings in **Homebridge Config UI X**.
2. **Step 1** — paste the Supla **Server URL**, **Client ID**, and **Client Secret**.
3. **Step 2** — click **Open Supla authorization**. A new tab opens with the
   Supla consent screen. Approve. Supla redirects to `http://localhost?code=…` —
   the page will not load (expected). Copy the **full redirect URL** from the
   address bar back to the plugin UI and click **Exchange code for tokens**.
4. **Step 3** — click **Test connection & detect meters**, tick the meters you
   want to expose, pick presentation mode, and **Save configuration**.

Homebridge will pick up the changes automatically (or after a restart depending
on the Config UI X version).

### 3. View the data in Eve for HomeKit

1. Install [Eve for HomeKit](https://apps.apple.com/app/eve-for-homekit/id917695792)
2. The MEW-01 meter appears in **At a Glance** as a Power tile
3. Live values and history (after ~15–20 minutes of polling) show up there

---

## Configuration reference

Filled in by the UI. Listed only for reference — do not edit by hand.

| Field | Type | Default | Notes |
|---|---|---|---|
| `serverUrl` | string | — | e.g. `https://svr57.supla.org` |
| `clientId` | string | — | OAuth Public ID |
| `clientSecret` | string | — | OAuth secret |
| `refreshToken` | string | — | Obtained during authorization |
| `accessToken` / `accessTokenExpiresAt` | — | auto | Cached for faster restarts |
| `pollInterval` | integer | `30` | Seconds; minimum `10` |
| `mode` | `combined` \| `perPhase` | `combined` | Presentation mode |
| `channels` | `int[]` | auto | Specific Supla channel IDs to expose |

Tokens rotated by Supla during refresh are persisted in
`<homebridge-storage>/supla-mew01-tokens.json` so restarts survive
refresh-token rotation.

---

## Troubleshooting

**"Authorization code exchange failed"**
- Verify the Redirect URI in the OAuth app is exactly `http://localhost`.
- The code is single-use — obtain a new one by clicking **Open Supla
  authorization** again.
- Client Secret must be pasted without any leading/trailing whitespace.

**"Token rejected" on Test connection**
- The refresh token has been revoked (e.g. you deleted the OAuth app or
  regenerated the secret). Re-authorize in step 2.

**No meters detected**
- Verify the meter is paired with your Supla account and set as *Electricity
  meter* (Supla function ID `310`).
- OAuth scope is fixed at `channels_r` — enough for read-only meter access.

**Numbers don't update in Eve**
- Check the Homebridge log — polling errors are reported as `warn`.
- Default poll is 30 s; raise up to 600 s if rate-limited.

---

## Developer notes

```bash
git clone https://github.com/artrybka/homebridge-supla-zamel-mew01
cd homebridge-supla-zamel-mew01
npm install && npm run build

# Print the authorization URL (paste the resulting code into SUPLA_AUTH_CODE below):
SUPLA_CLIENT_ID=... SUPLA_SERVER_URL=https://svr57.supla.org \
  npm run probe -- --auth-url

# Exchange the code and list meters:
SUPLA_CLIENT_ID=... SUPLA_CLIENT_SECRET=... SUPLA_SERVER_URL=https://svr57.supla.org \
  SUPLA_AUTH_CODE=... \
  npm run probe

# Re-use an already-obtained refresh token:
SUPLA_CLIENT_ID=... SUPLA_CLIENT_SECRET=... SUPLA_SERVER_URL=... \
  SUPLA_REFRESH_TOKEN=... \
  npm run probe
```

---

## License

MIT — see [LICENSE](LICENSE).
