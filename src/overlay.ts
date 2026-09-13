/**
 * All on-page UI lives in one shadow root attached to <html>: underline
 * highlights, the suggestion card and the per-field status badge.
 */
import { TYPE_LABELS } from './constants';
import type { Correction } from './types';

export interface UnderlineItem {
  correction: Correction;
  rects: DOMRect[];
}

export type BadgeKind = 'hidden' | 'checking' | 'count' | 'error' | 'setup';

export interface BadgeState {
  kind: BadgeKind;
  count: number;
  /** Content box of the focused field; badge sits in its bottom-right corner. */
  anchor: DOMRect | null;
}

export interface OverlayOwner {
  accept(c: Correction): void;
  dismiss(c: Correction): void;
  badgeClick(): void;
}

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; margin: 0; padding: 0; }
.layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483646; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
.ul { position: fixed; pointer-events: auto; cursor: pointer; border-bottom: 2px solid var(--c); border-radius: 1px; transition: background-color .12s; }
.ul:hover, .ul.active { background: color-mix(in srgb, var(--c) 18%, transparent); }
.ul[data-type="spelling"] { --c: #e5484d; }
.ul[data-type="grammar"], .ul[data-type="preposition"] { --c: #3b82f6; }
.ul[data-type="punctuation"] { --c: #f59e0b; }
.ul[data-type="capitalization"] { --c: #8b5cf6; }
.ul[data-type="missing-words"] { --c: #14b8a6; }

.badge { position: fixed; pointer-events: auto; display: flex; align-items: center; justify-content: center; gap: 5px; min-width: 22px; height: 22px; padding: 0 7px; border-radius: 11px; font-size: 11px; font-weight: 600; letter-spacing: .01em; color: #fff; background: #1f2430; box-shadow: 0 1px 3px rgba(0,0,0,.28), 0 0 0 1px rgba(255,255,255,.06) inset; cursor: default; user-select: none; transition: transform .15s, opacity .15s; opacity: .92; }
.badge:hover { opacity: 1; transform: translateY(-1px); }
.badge[data-kind="count"] { background: #b42318; cursor: pointer; }
.badge[data-kind="count"][data-zero] { background: #12805c; cursor: default; }
.badge[data-kind="checking"] .dot { width: 8px; height: 8px; border-radius: 50%; background: #3ddc97; animation: pulse 1s ease-in-out infinite; }
.badge[data-kind="error"] { background: #7a4b00; cursor: pointer; }
.badge[data-kind="setup"] { background: #2b3a67; cursor: pointer; }
@keyframes pulse { 0%,100% { opacity: .35; transform: scale(.8);} 50% { opacity: 1; transform: scale(1);} }

.card { position: fixed; pointer-events: auto; width: 300px; max-width: calc(100vw - 24px); background: #fff; color: #1a1d26; border-radius: 12px; box-shadow: 0 12px 32px rgba(15,18,28,.22), 0 0 0 1px rgba(15,18,28,.08); padding: 12px 14px 12px; font-size: 13.5px; line-height: 1.45; animation: rise .14s ease-out; }
@keyframes rise { from { opacity: 0; transform: translateY(4px);} to { opacity: 1; transform: none;} }
.card .kind { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: #6b7280; margin-bottom: 8px; }
.card .kind::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--c); }
.card .diff { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 10px; margin-bottom: 6px; }
.card .old { color: #9ca3af; text-decoration: line-through; text-decoration-color: #e5484d; overflow-wrap: anywhere; }
.card .new { font-weight: 600; color: #12805c; overflow-wrap: anywhere; }
.card .new.remove { color: #b42318; font-style: italic; font-weight: 500; }
.card .why { color: #4b5563; font-size: 12.5px; margin-bottom: 8px; }
.card .actions { display: flex; gap: 8px; margin-top: 8px; }
.card button { appearance: none; border: 0; border-radius: 8px; padding: 7px 12px; font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
.card .accept { background: #12805c; color: #fff; }
.card .accept:hover { background: #0f6b4d; }
.card .dismiss { background: #f3f4f6; color: #374151; }
.card .dismiss:hover { background: #e5e7eb; }
`;

export class Overlay {
  private host: HTMLElement;
  private layer: HTMLDivElement;
  private card: HTMLDivElement;
  private badge: HTMLDivElement;
  private items = new Map<OverlayOwner, UnderlineItem[]>();
  private badgeState: { owner: OverlayOwner; state: BadgeState } | null = null;
  private cardFor: { owner: OverlayOwner; correction: Correction } | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | undefined;
  private raf = 0;
  /** Called right before painting so owners can refresh their geometry. */
  onBeforeRender: (() => void) | null = null;

  constructor() {
    this.host = document.createElement('grammafy-overlay');
    this.host.setAttribute('data-grammafy-host', '');
    const root = this.host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = CSS;
    this.layer = document.createElement('div');
    this.layer.className = 'layer';
    this.card = document.createElement('div');
    this.card.className = 'card';
    this.card.hidden = true;
    this.badge = document.createElement('div');
    this.badge.className = 'badge';
    this.badge.hidden = true;
    this.layer.append(this.badge, this.card);
    root.append(style, this.layer);
    this.mount();

    this.card.addEventListener('mouseenter', () => clearTimeout(this.hideTimer));
    this.card.addEventListener('mouseleave', () => this.scheduleHideCard());
    this.badge.addEventListener('click', (e) => {
      e.stopPropagation();
      this.badgeState?.owner.badgeClick();
    });
    // Keep page focus where it is when interacting with our UI.
    this.layer.addEventListener('mousedown', (e) => e.preventDefault());
  }

  private mount(): void {
    if (!this.host.isConnected) document.documentElement.appendChild(this.host);
  }

  destroy(): void {
    this.host.remove();
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  // ---- data from field controllers -----------------------------------------

  setUnderlines(owner: OverlayOwner, items: UnderlineItem[]): void {
    if (items.length === 0) this.items.delete(owner);
    else this.items.set(owner, items);
    if (this.cardFor?.owner === owner) {
      const still = items.find((i) => i.correction === this.cardFor!.correction);
      if (!still) this.hideCard();
      else this.positionCard(still.rects[0]);
    }
  }

  setBadge(owner: OverlayOwner, state: BadgeState): void {
    if (state.kind === 'hidden' || !state.anchor) {
      if (this.badgeState?.owner === owner) this.badgeState = null;
    } else {
      this.badgeState = { owner, state };
    }
  }

  remove(owner: OverlayOwner): void {
    this.items.delete(owner);
    if (this.badgeState?.owner === owner) this.badgeState = null;
    if (this.cardFor?.owner === owner) this.hideCard();
    this.scheduleRender();
  }

  // ---- rendering ----------------------------------------------------------

  scheduleRender(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.onBeforeRender?.();
      this.render();
    });
  }

  private render(): void {
    this.mount();
    for (const el of Array.from(this.layer.querySelectorAll('.ul'))) el.remove();
    for (const [owner, items] of this.items) {
      for (const item of items) {
        for (const r of item.rects) {
          const u = document.createElement('div');
          u.className = 'ul';
          if (this.cardFor?.correction === item.correction) u.classList.add('active');
          u.dataset.type = item.correction.type;
          u.style.left = `${r.left}px`;
          u.style.top = `${r.top}px`;
          u.style.width = `${Math.max(2, r.width)}px`;
          u.style.height = `${r.height}px`;
          u.addEventListener('mouseenter', () => this.showCard(owner, item));
          u.addEventListener('mouseleave', () => this.scheduleHideCard());
          u.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showCard(owner, item);
          });
          this.layer.insertBefore(u, this.badge);
        }
      }
    }

    const b = this.badgeState;
    if (!b || !b.state.anchor) {
      this.badge.hidden = true;
      return;
    }
    const { kind, count, anchor } = b.state;
    this.badge.hidden = false;
    this.badge.dataset.kind = kind;
    if (kind === 'count' && count === 0) this.badge.dataset.zero = '';
    else delete this.badge.dataset.zero;
    this.badge.title =
      kind === 'checking'
        ? 'Grammafy is checking…'
        : kind === 'count'
        ? count === 0
          ? 'No issues found'
          : `${count} suggestion${count === 1 ? '' : 's'} — click to fix all`
        : kind === 'setup'
        ? 'Grammafy needs the on-device model — click to set up'
        : 'Grammafy could not check this text — click for details';
    this.badge.replaceChildren();
    if (kind === 'checking') {
      const dot = document.createElement('span');
      dot.className = 'dot';
      this.badge.append(dot);
    } else if (kind === 'count') {
      this.badge.textContent = count === 0 ? '✓' : String(count);
    } else if (kind === 'setup') {
      this.badge.textContent = 'Set up';
    } else {
      this.badge.textContent = '!';
    }
    const w = this.badge.offsetWidth || 22;
    this.badge.style.left = `${anchor.right - w - 8}px`;
    this.badge.style.top = `${anchor.bottom - 22 - 8}px`;
  }

  // ---- card ---------------------------------------------------------------

  private showCard(owner: OverlayOwner, item: UnderlineItem): void {
    clearTimeout(this.hideTimer);
    const c = item.correction;
    if (this.cardFor?.correction !== c) {
      this.cardFor = { owner, correction: c };
      this.card.replaceChildren();
      const kind = document.createElement('div');
      kind.className = 'kind';
      kind.style.setProperty('--c', colorFor(c.type));
      kind.textContent = TYPE_LABELS[c.type] ?? 'Suggestion';
      const diff = document.createElement('div');
      diff.className = 'diff';
      const oldEl = document.createElement('span');
      oldEl.className = 'old';
      oldEl.textContent = c.original;
      const newEl = document.createElement('span');
      newEl.className = 'new';
      if (c.replacement.trim() === '') {
        newEl.classList.add('remove');
        newEl.textContent = 'Remove';
      } else {
        newEl.textContent = c.replacement;
      }
      diff.append(oldEl, newEl);
      this.card.append(kind, diff);
      if (c.explanation) {
        const why = document.createElement('div');
        why.className = 'why';
        why.textContent = c.explanation;
        this.card.append(why);
      }
      const actions = document.createElement('div');
      actions.className = 'actions';
      const accept = document.createElement('button');
      accept.className = 'accept';
      accept.textContent = 'Accept';
      accept.addEventListener('click', (e) => {
        e.stopPropagation();
        this.hideCard();
        owner.accept(c);
      });
      const dismiss = document.createElement('button');
      dismiss.className = 'dismiss';
      dismiss.textContent = 'Dismiss';
      dismiss.addEventListener('click', (e) => {
        e.stopPropagation();
        this.hideCard();
        owner.dismiss(c);
      });
      actions.append(accept, dismiss);
      this.card.append(actions);
      this.scheduleRender();
    }
    this.card.hidden = false;
    this.positionCard(item.rects[0]);
  }

  private positionCard(anchor: DOMRect | undefined): void {
    if (!anchor) return;
    const w = this.card.offsetWidth || 300;
    const h = this.card.offsetHeight || 120;
    let left = Math.min(anchor.left, window.innerWidth - w - 12);
    left = Math.max(12, left);
    let top = anchor.bottom + 8;
    if (top + h > window.innerHeight - 12) top = anchor.top - h - 8;
    if (top < 12) top = 12;
    this.card.style.left = `${left}px`;
    this.card.style.top = `${top}px`;
  }

  private scheduleHideCard(): void {
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => this.hideCard(), 220);
  }

  hideCard(): void {
    clearTimeout(this.hideTimer);
    if (!this.cardFor) return;
    this.cardFor = null;
    this.card.hidden = true;
    this.scheduleRender();
  }
}

function colorFor(type: Correction['type']): string {
  switch (type) {
    case 'spelling':
      return '#e5484d';
    case 'punctuation':
      return '#f59e0b';
    case 'capitalization':
      return '#8b5cf6';
    case 'missing-words':
      return '#14b8a6';
    default:
      return '#3b82f6';
  }
}
