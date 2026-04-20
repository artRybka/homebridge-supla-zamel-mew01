/**
 * Manual smoke-test for the OAuth-based SuplaClient.
 *
 * Usage (one-shot exchange + listing):
 *   SUPLA_CLIENT_ID=... SUPLA_CLIENT_SECRET=... SUPLA_SERVER_URL=https://svr57.supla.org \
 *     SUPLA_AUTH_CODE=XXX \
 *     npm run probe
 *
 * Usage (re-use existing refresh token):
 *   SUPLA_CLIENT_ID=... SUPLA_CLIENT_SECRET=... SUPLA_SERVER_URL=https://svr57.supla.org \
 *     SUPLA_REFRESH_TOKEN=YYY \
 *     [SUPLA_CHANNEL_ID=123456] \
 *     npm run probe
 *
 * Print the authorization URL only (no calls):
 *   SUPLA_CLIENT_ID=... SUPLA_SERVER_URL=https://svr57.supla.org npm run probe -- --auth-url
 */
import {
  DEFAULT_REDIRECT_URI,
  SuplaApiError,
  SuplaClient,
  SuplaOAuthError,
} from '../src/suplaClient';

async function main(): Promise<void> {
  const clientId = process.env.SUPLA_CLIENT_ID;
  const clientSecret = process.env.SUPLA_CLIENT_SECRET;
  const serverUrl = process.env.SUPLA_SERVER_URL;
  const authCode = process.env.SUPLA_AUTH_CODE;
  const refreshToken = process.env.SUPLA_REFRESH_TOKEN;
  const channelId = process.env.SUPLA_CHANNEL_ID;

  const printAuthUrlOnly = process.argv.includes('--auth-url');

  if (!clientId || !serverUrl) {
    console.error('Missing SUPLA_CLIENT_ID or SUPLA_SERVER_URL.');
    process.exit(1);
  }

  if (printAuthUrlOnly) {
    const url = SuplaClient.buildAuthorizeUrl(
      { clientId, clientSecret: clientSecret || '', serverUrl },
      `probe-${Math.random().toString(36).slice(2, 10)}`,
    );
    console.log(url);
    return;
  }

  if (!clientSecret) {
    console.error('Missing SUPLA_CLIENT_SECRET.');
    process.exit(1);
  }

  const credentials = { clientId, clientSecret, serverUrl };

  let tokens;
  if (authCode) {
    try {
      tokens = await SuplaClient.exchangeCode(credentials, authCode, DEFAULT_REDIRECT_URI);
      console.error('Exchanged authorization code for tokens:');
      console.error(JSON.stringify({
        refreshToken: tokens.refreshToken ?? '(not issued — re-authorize when access_token expires)',
        accessTokenExpiresAt: new Date(tokens.accessTokenExpiresAt).toISOString(),
      }, null, 2));
    } catch (e) {
      if (e instanceof SuplaOAuthError) {
        console.error(`OAuth error: ${e.message}`);
        if (e.body) console.error(e.body);
      } else {
        console.error(e);
      }
      process.exit(1);
    }
  } else if (refreshToken) {
    tokens = { accessToken: '', refreshToken: refreshToken as string | null, accessTokenExpiresAt: 0 };
  } else {
    console.error('Provide either SUPLA_AUTH_CODE (first-time) or SUPLA_REFRESH_TOKEN (subsequent runs).');
    process.exit(1);
  }

  const client = new SuplaClient(credentials, tokens);

  try {
    if (channelId) {
      const channel = await client.getChannel(Number(channelId));
      console.log(JSON.stringify(channel, null, 2));
      return;
    }
    const meters = await client.listElectricityMeters();
    console.error(`Found ${meters.length} electricity meter(s).`);
    console.log(JSON.stringify(meters, null, 2));
  } catch (e) {
    if (e instanceof SuplaApiError) {
      console.error(`API error ${e.status}: ${e.message}`);
      if (e.body) console.error(`Body: ${e.body}`);
    } else if (e instanceof SuplaOAuthError) {
      console.error(`OAuth error: ${e.message}`);
      if (e.body) console.error(e.body);
    } else {
      console.error(e);
    }
    process.exit(1);
  }
}

main();
