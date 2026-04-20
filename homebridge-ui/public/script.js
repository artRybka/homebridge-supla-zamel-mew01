/* global homebridge */

const $ = (id) => document.getElementById(id);

const state = {
  tokens: null,
  meters: [],
  selectedChannelIds: new Set(),
  discoveredServerUrl: '',
};

(async function init() {
  try {
    const configList = await homebridge.getPluginConfig();
    const cfg = (configList && configList[0]) || {};

    if (cfg.name) $('name').value = cfg.name;
    if (cfg.serverUrl) $('serverUrl').value = cfg.serverUrl;
    if (cfg.clientId) $('clientId').value = cfg.clientId;
    if (cfg.clientSecret) $('clientSecret').value = cfg.clientSecret;
    if (cfg.pollInterval) $('pollInterval').value = cfg.pollInterval;
    if (cfg.mode) $('mode').value = cfg.mode;

    if (cfg.refreshToken) {
      state.tokens = {
        refreshToken: cfg.refreshToken,
        accessToken: cfg.accessToken || '',
        accessTokenExpiresAt: cfg.accessTokenExpiresAt || 0,
      };
      markStepDone('step2', 'authorized');
    }

    if (Array.isArray(cfg.channels)) {
      cfg.channels.forEach((id) => state.selectedChannelIds.add(Number(id)));
    }
  } catch (e) {
    homebridge.toast.error(`Failed to load config: ${e.message || e}`);
  }

  $('authorizeBtn').addEventListener('click', onAuthorize);
  $('exchangeBtn').addEventListener('click', onExchange);
  $('testBtn').addEventListener('click', onTestConnection);
  $('saveBtn').addEventListener('click', onSave);
})();

function markStepDone(stepId, label) {
  const el = $(stepId);
  if (el) el.classList.add('done');
  const badge = $(`${stepId}Badge`);
  if (badge) badge.innerHTML = `<span class="badge ok">${label || 'done'}</span>`;
}

function credentialsFromForm() {
  return {
    clientId: $('clientId').value.trim(),
    clientSecret: $('clientSecret').value.trim(),
    serverUrl: $('serverUrl').value.trim(),
  };
}

async function onAuthorize() {
  const creds = credentialsFromForm();
  if (!creds.clientId || !creds.clientSecret || !creds.serverUrl) {
    homebridge.toast.error('Fill Server URL, Client ID and Client Secret first.');
    return;
  }

  try {
    const { url } = await homebridge.request('/build-authorize-url', creds);
    window.open(url, '_blank', 'noopener');
    const link = $('authorizeLink');
    link.href = url;
    link.textContent = 'If the tab did not open, click here';
    link.style.display = 'inline';
    markStepDone('step1', 'credentials entered');
    $('redirectUrl').focus();
  } catch (e) {
    homebridge.toast.error(e.message || 'Could not build authorization URL.');
  }
}

async function onExchange() {
  const creds = credentialsFromForm();
  const redirectInput = $('redirectUrl').value.trim();
  if (!redirectInput) {
    homebridge.toast.error('Paste the redirect URL or code from Supla.');
    return;
  }

  $('exchangeBtn').disabled = true;
  homebridge.showSpinner();
  try {
    const result = await homebridge.request('/exchange-code', {
      ...creds,
      code: redirectInput,
    });
    state.tokens = result.tokens;
    markStepDone('step2', 'authorized');
    homebridge.toast.success('Authorization successful. Refresh token stored.');
  } catch (e) {
    homebridge.toast.error(e.message || 'Exchange failed.');
  } finally {
    homebridge.hideSpinner();
    $('exchangeBtn').disabled = false;
  }
}

async function onTestConnection() {
  if (!state.tokens || !state.tokens.refreshToken) {
    homebridge.toast.error('Authorize with Supla (step 2) first.');
    return;
  }
  const creds = credentialsFromForm();

  $('testBtn').disabled = true;
  homebridge.showSpinner();
  try {
    const result = await homebridge.request('/test-connection', {
      ...creds,
      tokens: state.tokens,
    });
    state.discoveredServerUrl = result.serverUrl;
    state.meters = result.meters || [];
    renderMeterList();
    if (state.meters.length === 0) {
      homebridge.toast.warning('Authorization works, but no MEW-01 / LEW-01 meters were found.');
    } else {
      homebridge.toast.success(`Found ${state.meters.length} meter(s).`);
      markStepDone('step3', `${state.meters.length} meter(s)`);
    }
  } catch (e) {
    homebridge.toast.error(e.message || 'Test connection failed.');
  } finally {
    homebridge.hideSpinner();
    $('testBtn').disabled = false;
  }
}

function renderMeterList() {
  const container = $('meterList');
  if (!state.meters.length) {
    container.innerHTML = '<div class="empty">No meters discovered yet.</div>';
    return;
  }

  const rows = state.meters.map((m) => {
    const checked = state.selectedChannelIds.has(m.id) ? 'checked' : '';
    const badge = m.connected
      ? '<span class="badge online">online</span>'
      : '<span class="badge offline">offline</span>';
    return `
      <tr>
        <td><input type="checkbox" data-channel-id="${m.id}" ${checked} /></td>
        <td>${escapeHtml(m.caption)}</td>
        <td>${m.id}</td>
        <td>${m.phaseCount}-phase</td>
        <td>${badge}</td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <table>
      <thead>
        <tr><th></th><th>Caption</th><th>Channel ID</th><th>Phases</th><th>Status</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  container.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener('change', (ev) => {
      const id = Number(ev.target.dataset.channelId);
      if (ev.target.checked) state.selectedChannelIds.add(id);
      else state.selectedChannelIds.delete(id);
    });
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

async function onSave() {
  const creds = credentialsFromForm();
  if (!creds.clientId || !creds.clientSecret || !creds.serverUrl) {
    homebridge.toast.error('Step 1 fields (Server URL, Client ID, Secret) are required.');
    return;
  }
  if (!state.tokens || !state.tokens.refreshToken) {
    homebridge.toast.error('Authorize with Supla (step 2) before saving.');
    return;
  }

  const serverUrl = /^https?:\/\//i.test(creds.serverUrl) ? creds.serverUrl : `https://${creds.serverUrl}`;

  const config = {
    platform: 'SuplaMew01',
    name: $('name').value.trim() || 'Supla MEW-01',
    serverUrl: serverUrl.replace(/\/+$/, ''),
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
    refreshToken: state.tokens.refreshToken,
    accessToken: state.tokens.accessToken || '',
    accessTokenExpiresAt: state.tokens.accessTokenExpiresAt || 0,
    pollInterval: Number($('pollInterval').value) || 30,
    mode: $('mode').value || 'combined',
  };

  if (state.selectedChannelIds.size > 0) {
    config.channels = Array.from(state.selectedChannelIds).sort((a, b) => a - b);
  }

  try {
    await homebridge.updatePluginConfig([config]);
    await homebridge.savePluginConfig();
    homebridge.toast.success('Configuration saved.');
  } catch (e) {
    homebridge.toast.error(`Save failed: ${e.message || e}`);
  }
}
