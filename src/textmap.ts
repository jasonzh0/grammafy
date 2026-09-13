/**
 * Geometry helpers: map character offsets in a field's text to on-screen
 * rectangles, for both contenteditable roots and <textarea>/<input> controls.
 */

export type FieldElement = HTMLTextAreaElement | HTMLInputElement | HTMLElement;

export function isControl(
  el: FieldElement
): el is HTMLTextAreaElement | HTMLInputElement {
  return el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement;
}

// ---- contenteditable --------------------------------------------------------

export interface Segment {
  node: Text;
  start: number;
  end: number;
}

export interface EditableSnapshot {
  text: string;
  segments: Segment[];
}

const BLOCK_TAGS = new Set([
  'P',
  'DIV',
  'LI',
  'UL',
  'OL',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'BLOCKQUOTE',
  'PRE',
  'TR',
  'TABLE',
  'SECTION',
  'ARTICLE',
  'HEADER',
  'FOOTER',
  'FIGURE',
  'FIGCAPTION',
  'DD',
  'DT',
  'DL',
  'HR',
  'FORM',
  'FIELDSET',
  'ADDRESS',
  'NAV',
  'ASIDE',
  'MAIN',
]);
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT']);

/**
 * Serialize an editable root to plain text, remembering which text node owns
 * each character. Block boundaries and <br> become '\n' (not owned by a node).
 */
export function snapshotEditable(root: HTMLElement): EditableSnapshot {
  let text = '';
  const segments: Segment[] = [];
  const ensureBreak = () => {
    if (text.length > 0 && !text.endsWith('\n')) text += '\n';
  };
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node as Text;
      segments.push({ node: t, start: text.length, end: text.length + t.data.length });
      text += t.data;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    if (el.tagName === 'BR') {
      text += '\n';
      return;
    }
    if (SKIP_TAGS.has(el.tagName) || el.hasAttribute('data-grammafy-host')) return;
    const block = BLOCK_TAGS.has(el.tagName);
    if (block) ensureBreak();
    for (const child of Array.from(el.childNodes)) walk(child);
    if (block) ensureBreak();
  };
  for (const child of Array.from(root.childNodes)) walk(child);
  return { text, segments };
}

function locate(
  snap: EditableSnapshot,
  offset: number,
  atEnd: boolean
): { node: Text; offset: number } | null {
  let fallback: { node: Text; offset: number } | null = null;
  for (const seg of snap.segments) {
    if (offset < seg.start) break;
    if (offset > seg.end) continue;
    const pos = { node: seg.node, offset: offset - seg.start };
    if (atEnd ? offset > seg.start || seg.start === seg.end : offset < seg.end)
      return pos;
    fallback = pos;
  }
  return fallback;
}

export function rangeFromOffsets(
  snap: EditableSnapshot,
  start: number,
  end: number
): Range | null {
  const s = locate(snap, start, false);
  const e = locate(snap, end, true);
  if (!s || !e || !s.node.isConnected || !e.node.isConnected) return null;
  const range = document.createRange();
  try {
    range.setStart(s.node, s.offset);
    range.setEnd(e.node, e.offset);
  } catch {
    return null;
  }
  return range;
}

// ---- textarea / input mirror ------------------------------------------------

const MIRROR_PROPS = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'fontVariant',
  'fontStretch',
  'letterSpacing',
  'wordSpacing',
  'textTransform',
  'textIndent',
  'textAlign',
  'lineHeight',
  'tabSize',
  'direction',
  'textRendering',
  'fontKerning',
  'fontFeatureSettings',
] as const;

let mirror: HTMLDivElement | null = null;

function getMirror(): HTMLDivElement {
  if (!mirror || !mirror.isConnected) {
    mirror = document.createElement('div');
    mirror.setAttribute('data-grammafy-host', '');
    mirror.setAttribute('aria-hidden', 'true');
    Object.assign(mirror.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      visibility: 'hidden',
      pointerEvents: 'none',
      zIndex: '-1',
      overflow: 'hidden',
      overflowWrap: 'break-word',
      wordBreak: 'normal',
      margin: '0',
      padding: '0',
      border: '0',
      boxSizing: 'content-box',
      height: 'auto',
      contain: 'layout style',
    } satisfies Partial<CSSStyleDeclaration>);
    document.documentElement.appendChild(mirror);
  }
  return mirror;
}

const px = (v: string) => parseFloat(v) || 0;

/** Client rects for value[start, end) inside a textarea or input, before clipping. */
export function rectsForControl(
  el: HTMLTextAreaElement | HTMLInputElement,
  start: number,
  end: number
): DOMRect[] {
  const m = getMirror();
  const cs = getComputedStyle(el);
  for (const p of MIRROR_PROPS) m.style[p] = cs[p];
  const isArea = el instanceof HTMLTextAreaElement;
  const padL = px(cs.paddingLeft);
  const padR = px(cs.paddingRight);
  const padT = px(cs.paddingTop);
  const borderL = px(cs.borderLeftWidth);
  const borderT = px(cs.borderTopWidth);
  const contentWidth = Math.max(0, el.clientWidth - padL - padR);
  m.style.whiteSpace = isArea ? 'pre-wrap' : 'pre';
  m.style.width = isArea ? `${contentWidth}px` : 'max-content';

  const value = el.value;
  const span = document.createElement('span');
  span.textContent = value.slice(start, end);
  // Trailing zero-width space keeps a final line break from collapsing.
  m.replaceChildren(
    document.createTextNode(value.slice(0, start)),
    span,
    document.createTextNode(value.slice(end) + '​')
  );

  const rect = el.getBoundingClientRect();
  const mRect = m.getBoundingClientRect();
  const dx = rect.left + borderL + padL - mRect.left - el.scrollLeft;
  const dy = rect.top + borderT + padT - mRect.top - el.scrollTop;
  const out: DOMRect[] = [];
  for (const r of Array.from(span.getClientRects())) {
    out.push(new DOMRect(r.left + dx, r.top + dy, r.width, r.height));
  }
  return out;
}

// ---- Clipping ---------------------------------------------------------------

/** Client rect of the visible content box of `el` (excludes borders and scrollbars). */
export function contentBox(el: Element): DOMRect {
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const l = r.left + px(cs.borderLeftWidth);
  const t = r.top + px(cs.borderTopWidth);
  return new DOMRect(l, t, el.clientWidth || r.width, el.clientHeight || r.height);
}

/** Rects of every scrolling ancestor plus the viewport; rects must fit inside all of them. */
export function clipBoxes(el: Element): DOMRect[] {
  const boxes: DOMRect[] = [
    new DOMRect(0, 0, window.innerWidth, window.innerHeight),
    contentBox(el),
  ];
  let p = el.parentElement;
  while (p && p !== document.body && p !== document.documentElement) {
    const o = getComputedStyle(p).overflow;
    if (o !== 'visible') boxes.push(contentBox(p));
    p = p.parentElement;
  }
  return boxes;
}

export function clipRect(r: DOMRect, boxes: DOMRect[]): DOMRect | null {
  let l = r.left;
  let t = r.top;
  let rt = r.right;
  let b = r.bottom;
  for (const box of boxes) {
    l = Math.max(l, box.left);
    t = Math.max(t, box.top);
    rt = Math.min(rt, box.right);
    b = Math.min(b, box.bottom);
  }
  if (rt - l < 1 || b - t < 1) return null;
  return new DOMRect(l, t, rt - l, b - t);
}
