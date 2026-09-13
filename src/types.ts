/** Shared message and data shapes used across background, offscreen, popup and content script. */

export type CorrectionType =
  | 'spelling'
  | 'grammar'
  | 'punctuation'
  | 'capitalization'
  | 'preposition'
  | 'missing-words';

export interface Correction {
  /** Start offset (inclusive) into the checked text. */
  start: number;
  /** End offset (exclusive) into the checked text. */
  end: number;
  /** The text currently at [start, end). */
  original: string;
  /** Replacement text; empty string means "delete". */
  replacement: string;
  type: CorrectionType;
  explanation?: string;
}

export type EngineKind = 'proofreader' | 'prompt';

/**
 * ready        – a model is on disk and a session can be created immediately
 * downloadable – Chrome supports the API on this device, model not yet downloaded
 * downloading  – Chrome is fetching the model
 * unavailable  – device fails Chrome's hardware / disk requirements
 * unsupported  – this Chrome build has no built-in AI API at all (< 138)
 */
export type EngineStatus =
  | 'ready'
  | 'downloadable'
  | 'downloading'
  | 'unavailable'
  | 'unsupported';

export interface ProofreadResult {
  corrections: Correction[];
  engine: EngineKind;
}

export interface Settings {
  enabled: boolean;
  /** Hostnames where checking is paused. */
  disabledHosts: string[];
  /** Also check single-line <input type="text"> fields. */
  checkInputs: boolean;
  /** Lifetime count of accepted suggestions (for the popup). */
  acceptedCount: number;
}

// ---- Messages ---------------------------------------------------------------

export type ContentToBackground =
  | { type: 'PROOFREAD'; text: string }
  | { type: 'OPEN_POPUP' }
  | { type: 'ACCEPTED'; count: number };

export type BackgroundToOffscreen =
  | { target: 'offscreen'; type: 'OFFSCREEN_PROOFREAD'; text: string }
  | { target: 'offscreen'; type: 'OFFSCREEN_STATUS' };

export type ProofreadResponse =
  | ({ ok: true } & ProofreadResult)
  | { ok: false; error: string; status?: EngineStatus };
