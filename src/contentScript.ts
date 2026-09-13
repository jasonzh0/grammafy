/**
 * Content script entry: discovers editable fields as they receive focus and
 * hands each to a FieldController. This file only wires events and settings.
 */
import { hostMatches } from './constants';
import { FieldController, type FieldHost } from './field';
import { Overlay } from './overlay';
import { getSettings, onSettingsChange } from './settings';
import type { FieldElement } from './textmap';
import type { ContentToBackground, ProofreadResponse, Settings } from './types';

let settings: Settings | null = null;
let overlay: Overlay | null = null;
const fields = new Map<FieldElement, FieldController>();

function send<T>(message: ContentToBackground): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>;
}

const host: FieldHost = {
  async proofread(text) {
    try {
      const r = await send<ProofreadResponse | undefined>({ type: 'PROOFREAD', text });
      return r ?? { ok: false, error: 'No response' };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  },
  openPopup() {
    void send({ type: 'OPEN_POPUP' }).catch(() => undefined);
  },
  accepted(count) {
    void send({ type: 'ACCEPTED', count }).catch(() => undefined);
  },
  onDestroy(field) {
    fields.delete(field.el);
  },
};

function isActive(): boolean {
  return (
    !!settings &&
    settings.enabled &&
    !hostMatches(location.hostname, settings.disabledHosts)
  );
}

/** Resolve a focused node to the editable element we should manage, if any. */
function resolveField(node: EventTarget | null): FieldElement | null {
  if (!(node instanceof HTMLElement)) return null;
  if (node.closest('[data-grammafy-host]')) return null;
  let el: FieldElement | null = null;
  if (node instanceof HTMLTextAreaElement) {
    el = node;
  } else if (node instanceof HTMLInputElement) {
    if (!settings?.checkInputs) return null;
    if (!['text', 'search', ''].includes(node.type)) return null;
    el = node;
  } else if (node.isContentEditable) {
    let root: HTMLElement = node;
    while (root.parentElement && root.parentElement.isContentEditable)
      root = root.parentElement;
    el = root;
  }
  if (!el) return null;
  if ((el as HTMLInputElement).readOnly || (el as HTMLInputElement).disabled) return null;
  if (el.getAttribute('spellcheck') === 'false') return null; // code editors, etc.
  if (
    el.getAttribute('data-gramm') === 'false' ||
    el.getAttribute('data-grammafy') === 'false'
  ) {
    return null;
  }
  if (el.getAttribute('aria-hidden') === 'true') return null;
  return el;
}

function attach(target: EventTarget | null): void {
  if (!isActive() || !overlay) return;
  const el = resolveField(target);
  if (!el || fields.has(el)) return;
  fields.set(el, new FieldController(el, overlay, host));
  // The controller was created after the focus event that got us here.
  el.dispatchEvent(new FocusEvent('focus'));
}

const onFocusIn = (e: FocusEvent) => attach(e.target);
const onViewportChange = () => overlay?.scheduleRender();

function start(): void {
  if (overlay) return;
  overlay = new Overlay();
  overlay.onBeforeRender = () => {
    for (const f of Array.from(fields.values())) f.render();
  };
  document.addEventListener('focusin', onFocusIn, true);
  window.addEventListener('scroll', onViewportChange, { capture: true, passive: true });
  window.addEventListener('resize', onViewportChange);
  attach(document.activeElement);
}

function stop(): void {
  document.removeEventListener('focusin', onFocusIn, true);
  window.removeEventListener('scroll', onViewportChange, true);
  window.removeEventListener('resize', onViewportChange);
  for (const f of Array.from(fields.values())) f.destroy();
  fields.clear();
  overlay?.destroy();
  overlay = null;
}

async function main(): Promise<void> {
  settings = await getSettings();
  if (isActive()) start();
  onSettingsChange((next) => {
    settings = next;
    if (isActive()) start();
    else stop();
  });
}

void main();
