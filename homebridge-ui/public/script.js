/* global homebridge */

const $ = (id) => document.getElementById(id);

const state = {
  tokens: null,
  meters: [],
  selectedChannelIds: new Set(),
  discoveredServerUrl: '',
  // channelId -> { phaseLabels: string[3], enabledPhases: number[] }
  overridesById: {},
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

    if (cfg.refreshToken || cfg.accessToken) {
      state.tokens = {
        refreshToken: cfg.refreshToken || '',
        accessToken: cfg.accessToken || '',
        accessTokenExpiresAt: cfg.accessTokenExpiresAt || 0,
      };
      markStepDone('step2', 'authorized');
    }

    if (Array.isArray(cfg.channels)) {
      cfg.channels.forEach((id) => state.selectedChannelIds.add(Number(id)));
    }

    if (Array.isArray(cfg.meterOverrides)) {
      for (const o of cfg.meterOverrides) {
        if (!o || !Number.isFinite(o.channelId)) continue;
        state.overridesById[o.channelId] = {
          phaseLabels: Array.isArray(o.phaseLabels) ? o.phaseLabels.slice(0, 3) : ['', '', ''],
          enabledPhases: Array.isArray(o.enabledPhases) ? o.enabledPhases.slice() : null,
        };
      }
    }
  } catch (e) {
    homebridge.toast.error(`Failed to load config: ${e.message || e}`);
  }

  $('authorizeBtn').addEventListener('click', onAuthorize);
  $('exchangeBtn').addEventListener('click', onExchange);
  $('testBtn').addEventListener('click', onTestConnection);
  $('saveBtn').addEventListener('click', onSave);
  $('meterList').addEventListener('change', onMeterListChange);
})();

function markStepDone(stepId, label) {
  const el = $(stepId);
  if (el) el.classList.add('border-success');
  const badge = $(`${stepId}Badge`);
  if (badge) badge.innerHTML = `<span class="badge bg-success">${escapeHtml(label || 'done')}</span>`;
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
    link.classList.remove('d-none');
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
    if (state.tokens.refreshToken) {
      homebridge.toast.success('Authorization successful. Refresh token stored.');
    } else {
      const hours = Math.round((state.tokens.accessTokenExpiresAt - Date.now()) / 1000 / 3600 * 10) / 10;
      homebridge.toast.warning(
        `Authorized, but Supla did not issue a refresh token. Access token valid for ~${hours}h — ` +
        'you will need to re-authorize when it expires.'
      );
    }
  } catch (e) {
    homebridge.toast.error(e.message || 'Exchange failed.');
  } finally {
    homebridge.hideSpinner();
    $('exchangeBtn').disabled = false;
  }
}

async function onTestConnection() {
  if (!state.tokens || (!state.tokens.refreshToken && !state.tokens.accessToken)) {
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
    $('serverInfo').textContent = result.serverUrl ? `Server: ${result.serverUrl}` : '';
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

function ensureOverride(channelId, phaseCount) {
  let o = state.overridesById[channelId];
  if (!o) {
    o = { phaseLabels: ['', '', ''], enabledPhases: null };
    state.overridesById[channelId] = o;
  }
  if (!Array.isArray(o.phaseLabels)) o.phaseLabels = ['', '', ''];
  while (o.phaseLabels.length < phaseCount) o.phaseLabels.push('');
  return o;
}

function renderMeterList() {
  const container = $('meterList');
  if (!state.meters.length) {
    container.innerHTML = '<p class="text-muted fst-italic mb-0">No meters discovered yet.</p>';
    return;
  }

  const rows = state.meters.map((m) => {
    const checked = state.selectedChannelIds.has(m.id) ? 'checked' : '';
    const badge = m.connected
      ? '<span class="badge bg-success">online</span>'
      : '<span class="badge bg-danger">offline</span>';

    const phaseCount = Math.max(1, Math.min(3, m.phaseCount || 3));
    const override = ensureOverride(m.id, phaseCount);
    const enabledSet = override.enabledPhases && override.enabledPhases.length > 0
      ? new Set(override.enabledPhases)
      : null;

    const phaseFields = [];
    for (let i = 1; i <= phaseCount; i++) {
      const label = override.phaseLabels[i - 1] || '';
      const on = enabledSet ? enabledSet.has(i) : true;
      phaseFields.push(`
        <div class="phase-row">
          <div class="form-check">
            <input class="form-check-input" type="checkbox" id="ph-${m.id}-${i}"
                   data-role="phase-enable" data-channel-id="${m.id}" data-phase="${i}" ${on ? 'checked' : ''} />
            <label class="form-check-label fw-semibold" for="ph-${m.id}-${i}">L${i}</label>
          </div>
          <input type="text" class="form-control form-control-sm phase-name"
                 data-role="phase-label" data-channel-id="${m.id}" data-phase="${i}"
                 placeholder="e.g. Kitchen" value="${escapeHtml(label)}" />
        </div>
      `);
    }

    return `
      <tr>
        <td>
          <div class="form-check">
            <input class="form-check-input" type="checkbox" id="sel-${m.id}"
                   data-role="meter-select" data-channel-id="${m.id}" ${checked} />
          </div>
        </td>
        <td>${escapeHtml(m.caption)}</td>
        <td class="mono">${m.id}</td>
        <td>${m.phaseCount}-phase</td>
        <td>${badge}</td>
      </tr>
      <tr class="phase-config-row">
        <td></td>
        <td colspan="4">
          <details>
            <summary class="small">Phase names &amp; toggles</summary>
            <div class="phase-grid">${phaseFields.join('')}</div>
            <div class="form-text">
              Unchecking a phase hides its accessory (per-phase mode) or excludes it from the totals
              (combined mode). Names are used as accessory display names in per-phase mode.
            </div>
          </details>
        </td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <table class="table table-sm align-middle">
      <thead>
        <tr><th></th><th>Caption</th><th>Channel ID</th><th>Phases</th><th>Status</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function onMeterListChange(ev) {
  const target = ev.target;
  const role = target.dataset && target.dataset.role;
  if (!role) return;
  const channelId = Number(target.dataset.channelId);
  if (!channelId) return;

  if (role === 'meter-select') {
    if (target.checked) state.selectedChannelIds.add(channelId);
    else state.selectedChannelIds.delete(channelId);
    return;
  }

  const phaseCount = 3;
  const override = ensureOverride(channelId, phaseCount);

  if (role === 'phase-enable') {
    const phase = Number(target.dataset.phase);
    const current = new Set(
      override.enabledPhases && override.enabledPhases.length > 0
        ? override.enabledPhases
        : [1, 2, 3].slice(0, phaseCount),
    );
    if (target.checked) current.add(phase);
    else current.delete(phase);
    override.enabledPhases = Array.from(current).sort();
    if (override.enabledPhases.length === 0) {
      // Never save an empty enable list — reset to "all off explicitly".
      override.enabledPhases = [];
    }
  } else if (role === 'phase-label') {
    const phase = Number(target.dataset.phase);
    override.phaseLabels[phase - 1] = target.value;
  }
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
  if (!state.tokens || (!state.tokens.refreshToken && !state.tokens.accessToken)) {
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
    refreshToken: state.tokens.refreshToken || '',
    accessToken: state.tokens.accessToken || '',
    accessTokenExpiresAt: state.tokens.accessTokenExpiresAt || 0,
    pollInterval: Number($('pollInterval').value) || 30,
    mode: $('mode').value || 'combined',
  };

  if (state.selectedChannelIds.size > 0) {
    config.channels = Array.from(state.selectedChannelIds).sort((a, b) => a - b);
  }

  const overrides = [];
  for (const [channelId, o] of Object.entries(state.overridesById)) {
    const id = Number(channelId);
    const labels = Array.isArray(o.phaseLabels) ? o.phaseLabels.map((s) => String(s || '').trim()) : [];
    const hasLabel = labels.some((s) => s.length > 0);
    const enabled = Array.isArray(o.enabledPhases) ? o.enabledPhases : null;
    const allPhases = [1, 2, 3];
    const restrictsPhases = enabled !== null
      && enabled.length !== allPhases.length
      && !allPhases.every((p) => enabled.includes(p));
    if (hasLabel || restrictsPhases) {
      const entry = { channelId: id };
      if (hasLabel) entry.phaseLabels = labels;
      if (restrictsPhases) entry.enabledPhases = enabled;
      overrides.push(entry);
    }
  }
  if (overrides.length > 0) config.meterOverrides = overrides;

  try {
    await homebridge.updatePluginConfig([config]);
    await homebridge.savePluginConfig();
    homebridge.toast.success('Configuration saved.');
  } catch (e) {
    homebridge.toast.error(`Save failed: ${e.message || e}`);
  }
}
