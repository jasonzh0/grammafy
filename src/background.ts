/**
 * Service worker: routes proofread requests from content scripts to the
 * offscreen document that hosts the model, caches results, and closes the
 * offscreen document after a period of inactivity.
 */
import { OFFSCREEN_IDLE_MS } from './constants';
import type {
  BackgroundToOffscreen,
  ContentToBackground,
  ProofreadResponse,
} from './types';

const OFFSCREEN_URL = 'offscreen.html';
const CACHE_LIMIT = 300;

const cache = new Map<string, ProofreadResponse>();
let creating: Promise<void> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

async function hasOffscreen(): Promise<boolean> {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });
  return contexts.length > 0;
}

async function ensureOffscreen(): Promise<void> {
  if (await hasOffscreen()) return;
  if (!creating) {
    creating = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_URL,
        reasons: [chrome.offscreen.Reason.WORKERS],
        justification:
          "Hosts the on-device language model session that proofreads text. Chrome's built-in AI APIs are not available in service workers.",
      })
      .catch((err: unknown) => {
        // "Only a single offscreen document may be created" – a race; fine.
        if (!String(err).includes('single offscreen')) throw err;
      })
      .finally(() => {
        creating = null;
      });
  }
  await creating;
}

function touchIdle(): void {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    if (await hasOffscreen())
      await chrome.offscreen.closeDocument().catch(() => undefined);
  }, OFFSCREEN_IDLE_MS);
}

async function askOffscreen<T>(message: BackgroundToOffscreen): Promise<T> {
  await ensureOffscreen();
  touchIdle();
  return (await chrome.runtime.sendMessage(message)) as T;
}

function remember(text: string, response: ProofreadResponse): void {
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(text, response);
}

async function proofread(text: string): Promise<ProofreadResponse> {
  const hit = cache.get(text);
  if (hit) return hit;
  try {
    const response = await askOffscreen<ProofreadResponse>({
      target: 'offscreen',
      type: 'OFFSCREEN_PROOFREAD',
      text,
    });
    if (!response) return { ok: false, error: 'No response from engine' };
    if (response.ok) remember(text, response);
    return response;
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

chrome.runtime.onMessage.addListener(
  (message: ContentToBackground, sender, sendResponse: (r: unknown) => void) => {
    if (!message || typeof message !== 'object') return undefined;
    switch (message.type) {
      case 'PROOFREAD':
        void proofread(message.text).then(sendResponse);
        return true;
      case 'OPEN_POPUP':
        void chrome.action
          .openPopup(
            sender.tab?.windowId !== undefined ? { windowId: sender.tab.windowId } : {}
          )
          .catch(() => undefined)
          .then(() => sendResponse(true));
        return true;
      case 'ACCEPTED':
        void chrome.storage.sync
          .get({ acceptedCount: 0 })
          .then(({ acceptedCount }) =>
            chrome.storage.sync.set({
              acceptedCount: (acceptedCount as number) + message.count,
            })
          )
          .then(() => sendResponse(true));
        return true;
      default:
        return undefined;
    }
  }
);

chrome.runtime.onInstalled.addListener(() => {
  cache.clear();
});
