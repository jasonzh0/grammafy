import { TYPE_LABELS, hostMatches } from './constants';
import { downloadModel, getEngineStatus, proofread } from './engine';
import { getSettings, onSettingsChange, updateSettings } from './settings';
import type { EngineStatus, Settings } from './types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const pill = $('pill');
const statusText = $('status-text');
const statusActions = $('status-actions');
const downloadBtn = $<HTMLButtonElement>('download');
const diagnosticsBtn = $<HTMLButtonElement>('diagnostics');
const progress = $('progress');
const progressBar = progress.querySelector('i') as HTMLElement;
const enabled = $<HTMLInputElement>('enabled');
const pauseHost = $<HTMLInputElement>('pause-host');
const hostLabel = $('host-label');
const checkInputs = $<HTMLInputElement>('check-inputs');
const tryText = $<HTMLTextAreaElement>('try-text');
const tryRun = $<HTMLButtonElement>('try-run');
const tryResults = $('try-results');
const accepted = $('accepted');

let currentHost = '';
let status: EngineStatus = 'unsupported';

const PILL: Record<EngineStatus, string> = {
  ready: 'Ready',
  downloadable: 'Needs setup',
  downloading: 'Downloading',
  unavailable: 'Unavailable',
  unsupported: 'Unsupported',
};

function renderStatus(): void {
  pill.dataset.state = status;
  pill.textContent = PILL[status];
  statusActions.hidden = true;
  downloadBtn.hidden = true;
  diagnosticsBtn.hidden = true;
  progress.hidden = true;
  tryRun.disabled = status !== 'ready';
  switch (status) {
    case 'ready':
      statusText.innerHTML =
        '<strong>Gemini Nano is ready.</strong> Suggestions appear as you type in any text box.';
      break;
    case 'downloadable':
      statusText.innerHTML =
        "Grammafy runs on Chrome's built-in model. <strong>Download it once</strong> (a few GB, unmetered connection recommended) and everything stays on this computer.";
      statusActions.hidden = false;
      downloadBtn.hidden = false;
      break;
    case 'downloading':
      statusText.innerHTML = 'Chrome is downloading the model. This can take a while.';
      progress.hidden = false;
      progress.setAttribute('data-indeterminate', '');
      break;
    case 'unavailable':
      statusText.innerHTML =
        "This device doesn't meet Chrome's requirements for on-device AI (about 22 GB free disk plus a GPU with more than 4 GB VRAM, or 16 GB RAM and 4 cores).";
      statusActions.hidden = false;
      diagnosticsBtn.hidden = false;
      break;
    default:
      statusText.innerHTML =
        "This Chrome doesn't expose the built-in AI APIs. Grammafy needs <strong>Chrome 138 or newer</strong>.";
  }
}

async function refreshStatus(): Promise<void> {
  status = await getEngineStatus();
  renderStatus();
}

downloadBtn.addEventListener('click', async () => {
  downloadBtn.disabled = true;
  progress.hidden = false;
  progress.removeAttribute('data-indeterminate');
  progressBar.style.width = '0%';
  statusText.textContent = 'Downloading Gemini Nano…';
  try {
    await downloadModel((f) => {
      progressBar.style.width = `${Math.round(f * 100)}%`;
    });
  } catch (err) {
    statusText.textContent = `Download failed: ${String(err)}`;
  } finally {
    downloadBtn.disabled = false;
  }
  await refreshStatus();
});

diagnosticsBtn.addEventListener('click', () => {
  void chrome.tabs.create({ url: 'chrome://on-device-internals' });
});

// ---- Settings ---------------------------------------------------------------

function renderSettings(s: Settings): void {
  enabled.checked = s.enabled;
  checkInputs.checked = s.checkInputs;
  pauseHost.checked = currentHost !== '' && hostMatches(currentHost, s.disabledHosts);
  pauseHost.disabled = currentHost === '';
  accepted.textContent = String(s.acceptedCount);
}

enabled.addEventListener(
  'change',
  () => void updateSettings({ enabled: enabled.checked })
);
checkInputs.addEventListener(
  'change',
  () => void updateSettings({ checkInputs: checkInputs.checked })
);
pauseHost.addEventListener('change', async () => {
  const s = await getSettings();
  const list = s.disabledHosts.filter((h) => h.toLowerCase() !== currentHost);
  if (pauseHost.checked) list.push(currentHost);
  await updateSettings({ disabledHosts: list });
});

async function loadHost(): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tab?.url ? new URL(tab.url) : null;
    if (url && (url.protocol === 'http:' || url.protocol === 'https:')) {
      currentHost = url.hostname.toLowerCase();
    }
  } catch {
    currentHost = '';
  }
  hostLabel.textContent = currentHost || 'Not available on this page';
}

// ---- Try it -----------------------------------------------------------------

tryRun.addEventListener('click', async () => {
  const text = tryText.value.trim();
  tryResults.replaceChildren();
  if (!text) return;
  tryRun.disabled = true;
  tryRun.textContent = 'Checking…';
  try {
    const { corrections, engine } = await proofread(text);
    if (corrections.length === 0) {
      const ok = document.createElement('div');
      ok.className = 'ok';
      ok.textContent = 'No issues found.';
      tryResults.append(ok);
    }
    for (const c of corrections) {
      const row = document.createElement('div');
      row.className = 'fix';
      const oldEl = document.createElement('span');
      oldEl.className = 'old';
      oldEl.textContent = c.original;
      const newEl = document.createElement('span');
      newEl.className = 'new';
      newEl.textContent = c.replacement || '(remove)';
      const type = document.createElement('span');
      type.className = 'type';
      type.textContent = TYPE_LABELS[c.type] ?? c.type;
      row.append(oldEl, newEl, type);
      tryResults.append(row);
    }
    $('try-hint').textContent = `Engine: ${
      engine === 'proofreader' ? 'Proofreader API' : 'Prompt API'
    }`;
  } catch (err) {
    const e = document.createElement('div');
    e.className = 'err';
    e.textContent = String(err);
    tryResults.append(e);
  } finally {
    tryRun.disabled = false;
    tryRun.textContent = 'Check';
  }
});

// ---- Boot -------------------------------------------------------------------

void (async () => {
  $('version').textContent = `v${chrome.runtime.getManifest().version}`;
  await loadHost();
  renderSettings(await getSettings());
  onSettingsChange(renderSettings);
  await refreshStatus();
})();
