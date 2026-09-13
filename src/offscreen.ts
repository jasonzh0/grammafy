/** Offscreen document: owns the model session and answers proofread requests. */
import { getEngineStatus, proofread, resetEngine } from './engine';
import type { BackgroundToOffscreen, ProofreadResponse } from './types';

chrome.runtime.onMessage.addListener(
  (message: BackgroundToOffscreen, _sender, sendResponse: (r: unknown) => void) => {
    if (!message || message.target !== 'offscreen') return undefined;
    switch (message.type) {
      case 'OFFSCREEN_STATUS':
        void getEngineStatus().then(sendResponse);
        return true;
      case 'OFFSCREEN_PROOFREAD':
        void (async () => {
          const status = await getEngineStatus();
          if (status !== 'ready') {
            const r: ProofreadResponse = { ok: false, error: 'Model not ready', status };
            sendResponse(r);
            return;
          }
          try {
            const result = await proofread(message.text);
            sendResponse({ ok: true, ...result } satisfies ProofreadResponse);
          } catch (err) {
            resetEngine();
            sendResponse({
              ok: false,
              error: String(err),
              status,
            } satisfies ProofreadResponse);
          }
        })();
        return true;
      default:
        return undefined;
    }
  }
);
