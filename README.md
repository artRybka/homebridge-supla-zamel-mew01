# homebridge-supla-mew01

> **⚠️ Energy data is shown only in the [Eve for HomeKit](https://apps.apple.com/app/eve-for-homekit/id917695792) app, not in Apple Home.**
> Apple Home does not display energy / power characteristics natively. This plugin uses
> Elgato Eve custom characteristics (UUIDs `E863F1…`) plus `fakegato-history` for charts —
> all visible in the free Eve app. This is a HomeKit platform limitation, not a plugin bug.

Homebridge plugin that exposes **Zamel MEW-01 / MEW-01 LITE / LEW-01** energy meters
from **Supla Cloud** via its REST API as Eve-compatible HomeKit accessories.

Status: **work in progress** — see `homebridge-supla-mew01-spec.md` for the full design.

## Configuration

All configuration is done **exclusively through Homebridge Config UI X** — you never edit
`config.json` by hand. Paste your Supla Personal Access Token, click *Test connection*,
and pick the meters you want to expose.

## Manual probe (developer use)

To verify a token works against Supla Cloud before wiring up Homebridge:

```bash
npm install
npm run build
SUPLA_TOKEN=xxxx.yyyy npm run probe
```

Optional env vars: `SUPLA_SERVER_URL` (override the server decoded from the token),
`SUPLA_CHANNEL_ID` (fetch a single channel instead of listing all meters).

## License

MIT
