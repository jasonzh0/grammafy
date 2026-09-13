import type { Settings } from './types';

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  disabledHosts: [],
  checkInputs: false,
  acceptedCount: 0,
};

/** Wait this long after the last keystroke before checking. */
export const CHECK_DEBOUNCE_MS = 900;
/** Don't bother the model with fewer characters than this. */
export const MIN_TEXT_LENGTH = 4;
/** Only the first N characters of a field are checked. */
export const MAX_TEXT_LENGTH = 10_000;
/** Paragraphs longer than this are split at sentence boundaries. */
export const MAX_CHUNK_LENGTH = 1_200;
/** Discard a chunk's result if the model changed more than this share of it (rewrite guard). */
export const MAX_CHANGED_RATIO = 0.5;
/** Close the offscreen model host after this much idle time to free GPU memory. */
export const OFFSCREEN_IDLE_MS = 5 * 60 * 1000;

/** Human labels for correction kinds. */
export const TYPE_LABELS: Record<string, string> = {
  spelling: 'Spelling',
  grammar: 'Grammar',
  punctuation: 'Punctuation',
  capitalization: 'Capitalization',
  preposition: 'Preposition',
  'missing-words': 'Missing word',
};

/** Return true when `host` (or one of its parent domains) is in `list`. */
export function hostMatches(host: string, list: string[]): boolean {
  const h = host.toLowerCase();
  return list.some((entry) => {
    const e = entry.toLowerCase().trim();
    return e.length > 0 && (h === e || h.endsWith('.' + e));
  });
}
