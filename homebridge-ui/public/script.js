/* global homebridge */

const $ = (id) => document.getElementById(id);

const state = {
  serverUrl: '',
  meters: [],
  selectedChannelIds: new Set(),
};

(async function init() {
  try {
    const configList = await homebridge.getPluginConfig();
    const cfg = (configList && configList[0]) || {};

    if (cfg.name) $('name').value = cfg.name;
    if (cfg.accessToken) $('accessToken').value = cfg.accessToken;
    if (cfg.pollInterval) $('pollInterval').value = cfg.pollInterval;
    if (cfg.mode) $('mode').value = cfg.mode;

    if (Array.isArray(cfg.channels)) {
      cfg.channels.forEach((id) => state.selectedChannelIds.add(Number(id)));
    }
    if (cfg.serverUrl) {
      state.serverUrl = cfg.serverUrl;
      renderServerInfo();
    }
  } catch (e) {
    homebridge.toast.error(`Failed to load config: ${e.message || e}`);
  }

  $('testBtn').addEventListener('click', testConnection);
  $('saveBtn').addEventListener('click', save);
  $('accessToken').addEventListener('input', () => {
    $('testBtn').disabled = $('accessToken').value.trim().length === 0;
  });
  $('testBtn').disabled = $('accessToken').value.trim().length === 0;
})();

async function testConnection() {
  const accessToken = $('accessToken').value.trim();
  if (!accessToken) {
    homebridge.toast.error('Paste your access token first.');
    return;
  }

  $('testBtn').disabled = true;
  homebridge.showSpinner();
  try {
    const result = await homebridge.request('/test-connection', { accessToken });
    state.serverUrl = result.serverUrl;
    state.meters = result.meters || [];
    renderServerInfo();
    renderMeterList();
    if (state.meters.length === 0) {
      homebridge.toast.warning('No MEW-01 / LEW-01 meters found on this account.');
    } else {
      homebridge.toast.success(`Found ${state.meters.length} meter(s).`);
    }
  } catch (e) {
    const msg = (e && e.message) || 'Connection test failed.';
    homebridge.toast.error(msg);
  } finally {
    homebridge.hideSpinner();
    $('testBtn').disabled = false;
  }
}

function renderServerInfo() {
  $('serverInfo').textContent = state.serverUrl
    ? `Server: ${state.serverUrl}`
    : '';
}

function renderMeterList() {
  const container = $('meterList');
  if (!state.meters.length) {
    container.innerHTML = '<div class="empty">No meters discovered.</div>';
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

async function save() {
  const accessToken = $('accessToken').value.trim();
  if (!accessToken) {
    homebridge.toast.error('Access token is required.');
    return;
  }

  const config = {
    platform: 'SuplaMew01',
    name: $('name').value.trim() || 'Supla MEW-01',
    accessToken,
    pollInterval: Number($('pollInterval').value) || 30,
    mode: $('mode').value || 'combined',
  };

  if (state.serverUrl) {
    config.serverUrl = state.serverUrl;
  }

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
