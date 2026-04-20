/**
 * Manual smoke-test for SuplaClient.
 *
 * Usage:
 *   SUPLA_TOKEN=xxxx.yyyy npm run probe
 *   SUPLA_TOKEN=xxxx.yyyy SUPLA_SERVER_URL=https://svr3.supla.org npm run probe
 *   SUPLA_TOKEN=xxxx.yyyy SUPLA_CHANNEL_ID=123456 npm run probe
 */
import { SuplaApiError, SuplaClient, SuplaTokenError } from '../src/suplaClient';

async function main(): Promise<void> {
  const token = process.env.SUPLA_TOKEN;
  const serverUrl = process.env.SUPLA_SERVER_URL;
  const channelId = process.env.SUPLA_CHANNEL_ID;

  if (!token) {
    console.error('Missing SUPLA_TOKEN environment variable.');
    console.error('Generate one in Supla Cloud: My account → Integrations → Personal access tokens (scope: channels_r).');
    process.exit(1);
  }

  let client: SuplaClient;
  try {
    client = new SuplaClient(token, serverUrl);
  } catch (e) {
    if (e instanceof SuplaTokenError) {
      console.error(`Token error: ${e.message}`);
    } else {
      console.error(e);
    }
    process.exit(1);
  }

  console.error(`Resolved server URL: ${client.getBaseUrl()}`);

  try {
    if (channelId) {
      const channel = await client.getChannel(Number(channelId));
      console.log(JSON.stringify(channel, null, 2));
      return;
    }

    const meters = await client.listElectricityMeters();
    console.error(`Found ${meters.length} electricity meter(s) (functionId=310).`);
    console.log(JSON.stringify(meters, null, 2));
  } catch (e) {
    if (e instanceof SuplaApiError) {
      console.error(`API error ${e.status}: ${e.message}`);
      if (e.body) {
        console.error(`Body: ${e.body}`);
      }
    } else {
      console.error(e);
    }
    process.exit(1);
  }
}

main();
