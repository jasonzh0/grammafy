/**
 * One FieldController per editable element. It extracts the text, debounces
 * checks, keeps corrections aligned while the user keeps typing, draws them
 * through the shared Overlay and applies accepted replacements.
 */
import { CHECK_DEBOUNCE_MS, MAX_TEXT_LENGTH, MIN_TEXT_LENGTH } from './constants';
import type { Overlay, OverlayOwner, UnderlineItem } from './overlay';
import {
  clipBoxes,
  clipRect,
  contentBox,
  isControl,
  rangeFromOffsets,
  rectsForControl,
  snapshotEditable,
  type EditableSnapshot,
  type FieldElement,
} from './textmap';
import type { Correction, ProofreadResponse } from './types';

type Status = 'idle' | 'checking' | 'error' | 'setup';

export interface FieldHost {
  proofread(text: string): Promise<ProofreadResponse>;
  openPopup(): void;
  accepted(count: number): void;
  onDestroy(field: FieldController): void;
}

export class FieldController implements OverlayOwner {
  private corrections: Correction[] = [];
  private liveText = '';
  private checkedText = '';
  private dismissed = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inFlight = false;
  private rerunAfter = false;
  private status: Status = 'idle';
  private focused = false;
  private snapshot: EditableSnapshot | null = null;
  private destroyed = false;

  constructor(
    readonly el: FieldElement,
    private overlay: Overlay,
    private host: FieldHost
  ) {
    this.liveText = this.readText();
    el.addEventListener('input', this.onInput);
    el.addEventListener('focus', this.onFocus);
    el.addEventListener('blur', this.onBlur);
    el.addEventListener('scroll', this.onScroll, { passive: true });
  }

  // ---- text access ----------------------------------------------------------

  private readText(): string {
    if (isControl(this.el)) {
      this.snapshot = null;
      return this.el.value;
    }
    this.snapshot = snapshotEditable(this.el);
    return this.snapshot.text;
  }

  // ---- events ---------------------------------------------------------------

  private onInput = (): void => {
    const next = this.readText();
    this.corrections = shift(this.corrections, this.liveText, next);
    this.liveText = next;
    this.scheduleCheck();
    this.overlay.scheduleRender();
  };

  private onFocus = (): void => {
    this.focused = true;
    const next = this.readText();
    if (next !== this.liveText) {
      this.corrections = shift(this.corrections, this.liveText, next);
      this.liveText = next;
    }
    if (this.liveText !== this.checkedText) this.scheduleCheck(150);
    this.overlay.scheduleRender();
  };

  private onBlur = (): void => {
    this.focused = false;
    this.overlay.scheduleRender();
  };

  private onScroll = (): void => this.overlay.scheduleRender();

  // ---- checking -------------------------------------------------------------

  private scheduleCheck(delay = CHECK_DEBOUNCE_MS): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.check(), delay);
  }

  private async check(): Promise<void> {
    if (this.destroyed) return;
    if (this.inFlight) {
      this.rerunAfter = true;
      return;
    }
    const text = this.liveText.slice(0, MAX_TEXT_LENGTH);
    if (text.trim().length < MIN_TEXT_LENGTH || !/\p{L}{2}/u.test(text)) {
      this.corrections = [];
      this.checkedText = text;
      this.status = 'idle';
      this.overlay.scheduleRender();
      return;
    }
    if (text === this.checkedText) return;

    this.inFlight = true;
    this.status = 'checking';
    this.overlay.scheduleRender();
    const response = await this.host.proofread(text);
    this.inFlight = false;
    if (this.destroyed) return;

    if (!response.ok) {
      this.status = response.status && response.status !== 'ready' ? 'setup' : 'error';
      this.overlay.scheduleRender();
      return;
    }
    this.status = 'idle';
    let corrections = response.corrections.filter((c) => !this.dismissed.has(keyOf(c)));
    if (this.liveText !== text) {
      // User kept typing while we waited: realign, then re-check.
      corrections = shift(corrections, text, this.liveText);
      this.rerunAfter = true;
    }
    this.corrections = corrections;
    this.checkedText = text;
    this.overlay.scheduleRender();
    if (this.rerunAfter) {
      this.rerunAfter = false;
      this.scheduleCheck();
    }
  }

  // ---- rendering ------------------------------------------------------------

  /** Recompute geometry and push it to the overlay. Called before each paint. */
  render(): void {
    if (this.destroyed) return;
    if (!this.el.isConnected) {
      this.destroy();
      return;
    }
    const visible = isVisible(this.el);
    const items: UnderlineItem[] = [];
    if (this.corrections.length > 0 && visible) {
      const boxes = clipBoxes(this.el);
      const control = isControl(this.el);
      const snap = control
        ? null
        : this.snapshot ?? (this.snapshot = snapshotEditable(this.el));
      const text = control ? (this.el as HTMLTextAreaElement).value : snap!.text;
      const kept: Correction[] = [];
      for (const c of this.corrections) {
        if (text.slice(c.start, c.end) !== c.original) continue;
        kept.push(c);
        const raw = control
          ? rectsForControl(this.el as HTMLTextAreaElement, c.start, c.end)
          : Array.from(rangeFromOffsets(snap!, c.start, c.end)?.getClientRects() ?? []);
        const rects = raw
          .map((r) => clipRect(r, boxes))
          .filter((r): r is DOMRect => r !== null);
        if (rects.length) items.push({ correction: c, rects });
      }
      this.corrections = kept;
    }
    this.overlay.setUnderlines(this, items);

    let kind: 'hidden' | 'checking' | 'setup' | 'error' | 'count' = 'hidden';
    if (this.focused && visible) {
      if (this.status === 'checking') kind = 'checking';
      else if (this.status === 'setup') kind = 'setup';
      else if (this.status === 'error') kind = 'error';
      else if (this.checkedText.trim().length >= MIN_TEXT_LENGTH) kind = 'count';
    }
    this.overlay.setBadge(this, {
      kind,
      count: this.corrections.length,
      anchor: contentBox(this.el),
    });
  }

  // ---- OverlayOwner ---------------------------------------------------------

  accept(c: Correction): void {
    if (!this.corrections.includes(c)) return;
    if (this.applyReplacement(c)) this.host.accepted(1);
  }

  dismiss(c: Correction): void {
    this.dismissed.add(keyOf(c));
    this.corrections = this.corrections.filter((x) => x !== c);
    this.overlay.scheduleRender();
  }

  badgeClick(): void {
    if (this.status === 'setup' || this.status === 'error') {
      this.host.openPopup();
      return;
    }
    if (this.corrections.length === 0) return;
    // Apply from the end so earlier offsets stay valid.
    const all = [...this.corrections].sort((a, b) => b.start - a.start);
    let n = 0;
    for (const c of all) if (this.applyReplacement(c)) n++;
    if (n) this.host.accepted(n);
  }

  // ---- applying -------------------------------------------------------------

  private applyReplacement(c: Correction): boolean {
    const el = this.el;
    const current = this.readText();
    if (current.slice(c.start, c.end) !== c.original) {
      this.corrections = this.corrections.filter((x) => x !== c);
      this.overlay.scheduleRender();
      return false;
    }
    let ok = false;
    if (isControl(el)) {
      el.focus({ preventScroll: true });
      el.setSelectionRange(c.start, c.end);
      ok = exec(c.replacement);
      if (!ok || el.value === current) {
        // execCommand refused (or was a no-op): fall back to the native value
        // setter so React-style controlled inputs still notice the change.
        const proto =
          el instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        const next = current.slice(0, c.start) + c.replacement + current.slice(c.end);
        if (setter) setter.call(el, next);
        else el.value = next;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        ok = true;
      }
      const caret = c.start + c.replacement.length;
      try {
        el.setSelectionRange(caret, caret);
      } catch {
        /* ignore */
      }
    } else {
      const snap = this.snapshot ?? snapshotEditable(el);
      const range = rangeFromOffsets(snap, c.start, c.end);
      if (!range) return false;
      el.focus({ preventScroll: true });
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      ok = exec(c.replacement);
      if (!ok) {
        range.deleteContents();
        if (c.replacement) range.insertNode(document.createTextNode(c.replacement));
        range.collapse(false);
        el.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            inputType: 'insertText',
            data: c.replacement,
          })
        );
        ok = true;
      }
    }
    // onInput already realigned the remaining corrections; treat the new text
    // as checked so we don't immediately re-run the model.
    this.corrections = this.corrections.filter((x) => x !== c);
    this.checkedText = this.liveText = this.readText();
    clearTimeout(this.timer);
    this.overlay.scheduleRender();
    return ok;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    clearTimeout(this.timer);
    this.el.removeEventListener('input', this.onInput);
    this.el.removeEventListener('focus', this.onFocus);
    this.el.removeEventListener('blur', this.onBlur);
    this.el.removeEventListener('scroll', this.onScroll);
    this.overlay.remove(this);
    this.host.onDestroy(this);
  }
}

// ---- helpers ----------------------------------------------------------------

function keyOf(c: Correction): string {
  return `${c.original} ${c.replacement}`;
}

function exec(replacement: string): boolean {
  try {
    return replacement === ''
      ? document.execCommand('delete')
      : document.execCommand('insertText', false, replacement);
  } catch {
    return false;
  }
}

function isVisible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

/**
 * Realign corrections after `oldText` became `newText` through one contiguous
 * edit (the common case for a keystroke or paste). Corrections overlapping the
 * edited span are dropped; the ones after it are shifted.
 */
export function shift(
  corrections: Correction[],
  oldText: string,
  newText: string
): Correction[] {
  if (oldText === newText) return corrections;
  let prefix = 0;
  const max = Math.min(oldText.length, newText.length);
  while (prefix < max && oldText[prefix] === newText[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < max - prefix &&
    oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]
  ) {
    suffix++;
  }
  const oldEnd = oldText.length - suffix;
  const delta = newText.length - oldText.length;
  const out: Correction[] = [];
  for (const c of corrections) {
    if (c.end <= prefix) out.push(c);
    else if (c.start >= oldEnd)
      out.push({ ...c, start: c.start + delta, end: c.end + delta });
    // else: overlaps the edit → drop
  }
  return out;
}
