/**
 * Token-level diff between an original string and its corrected form.
 *
 * The Prompt API gives us back a whole corrected paragraph, not offsets, so we
 * reconstruct minimal edits ourselves. Tokens are words (incl. apostrophes and
 * hyphens), whitespace runs, or single punctuation characters, so an edit
 * always lands on a clean boundary that we can underline.
 */

export interface Edit {
  start: number;
  end: number;
  replacement: string;
}

interface Token {
  text: string;
  start: number;
  end: number;
}

const TOKEN_RE = /\s+|[\p{L}\p{N}][\p{L}\p{N}'’-]*|[^\s\p{L}\p{N}]/gu;

export function tokenize(text: string): Token[] {
  const out: Token[] = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    out.push({ text: m[0], start: m.index!, end: m.index! + m[0].length });
  }
  return out;
}

const isSpace = (s: string) => /^\s+$/.test(s);

/**
 * Compute edits that turn `original` into `corrected`.
 * Whitespace-only differences are ignored, and adjacent edits separated only
 * by whitespace are merged so a user sees one suggestion per phrase.
 */
export function diffEdits(original: string, corrected: string): Edit[] {
  if (original === corrected) return [];
  const a = tokenize(original);
  const b = tokenize(corrected);
  const n = a.length;
  const m = b.length;

  // LCS table on token text.
  const dp: Uint16Array[] = [];
  for (let i = 0; i <= n; i++) dp.push(new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i].text === b[j].text
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  // Walk the table emitting groups of changed tokens.
  type Group = { aStart: number; aEnd: number; bTokens: string[] };
  const groups: Group[] = [];
  let cur: Group | null = null;
  let i = 0;
  let j = 0;
  const flush = () => {
    if (cur) groups.push(cur);
    cur = null;
  };
  const open = (aIdx: number) => {
    if (!cur) cur = { aStart: aIdx, aEnd: aIdx, bTokens: [] };
  };
  while (i < n || j < m) {
    if (i < n && j < m && a[i].text === b[j].text) {
      flush();
      i++;
      j++;
    } else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) {
      open(i);
      cur!.bTokens.push(b[j].text);
      j++;
    } else {
      open(i);
      cur!.aEnd = i + 1;
      i++;
    }
  }
  flush();

  // Convert to character edits, dropping whitespace-only changes.
  let edits: Edit[] = [];
  for (const g of groups) {
    const origText = a
      .slice(g.aStart, g.aEnd)
      .map((t) => t.text)
      .join('');
    const repl = g.bTokens.join('');
    if (origText === repl) continue;
    if ((origText === '' || isSpace(origText)) && (repl === '' || isSpace(repl)))
      continue;
    const start = g.aStart < n ? a[g.aStart].start : original.length;
    const end = g.aEnd > g.aStart ? a[g.aEnd - 1].end : start;
    edits.push({ start, end, replacement: repl });
  }

  // Merge edits separated only by whitespace.
  const merged: Edit[] = [];
  for (const e of edits) {
    const prev = merged[merged.length - 1];
    if (prev && isSpace(original.slice(prev.end, e.start)) && e.start - prev.end <= 2) {
      prev.replacement += original.slice(prev.end, e.start) + e.replacement;
      prev.end = e.end;
    } else {
      merged.push({ ...e });
    }
  }
  edits = merged;

  // Pure insertions have nothing to underline: widen them to the previous
  // word (or the next one at the very start) so the user sees context.
  for (const e of edits) {
    if (e.start !== e.end) continue;
    const before = a.filter((t) => t.end <= e.start && !isSpace(t.text)).pop();
    if (before) {
      e.replacement = original.slice(before.start, e.start) + e.replacement;
      e.start = before.start;
      continue;
    }
    const after = a.find((t) => t.start >= e.end && !isSpace(t.text));
    if (after) {
      e.replacement = e.replacement + original.slice(e.end, after.end);
      e.end = after.end;
    }
  }
  return edits;
}

/** Share of `original` characters touched by `edits`, 0..1. */
export function changedRatio(original: string, edits: Edit[]): number {
  if (original.length === 0) return 0;
  const touched = edits.reduce(
    (sum, e) => sum + Math.max(e.end - e.start, e.replacement.length),
    0
  );
  return Math.min(1, touched / original.length);
}
