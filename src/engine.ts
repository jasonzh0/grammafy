/**
 * The proofreading engine. Runs in a document context (offscreen page or popup),
 * because Chrome's built-in AI APIs are not exposed to workers.
 *
 * Preference order:
 *   1. Proofreader API – purpose-built, returns offsets and explanations.
 *      Still an origin trial in most Chrome builds, so it is used only when
 *      the model is already present.
 *   2. Prompt API (Gemini Nano) – stable for extensions since Chrome 138.
 *      We ask for the corrected paragraph as JSON and diff it ourselves.
 */
import { MAX_CHANGED_RATIO, MAX_CHUNK_LENGTH } from './constants';
import { changedRatio, diffEdits } from './diff';
import type {
  Correction,
  CorrectionType,
  EngineKind,
  EngineStatus,
  ProofreadResult,
} from './types';

const SYSTEM_PROMPT = [
  'You are a meticulous English proofreader.',
  'Fix spelling, grammar, punctuation and capitalization mistakes in the text the user gives you.',
  "Keep the author's wording, tone, meaning, line breaks and formatting.",
  'Do not rewrite sentences that are already correct. Do not add, answer, summarize or comment.',
  'If the text has no mistakes, return it exactly as given.',
  'Respond with JSON of the form {"corrected": "<text>"}.',
].join(' ');

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: { corrected: { type: 'string' } },
  required: ['corrected'],
  additionalProperties: false,
} as const;

// ---- Status -----------------------------------------------------------------

function mapAvailability(a: AIAvailability): EngineStatus {
  switch (a) {
    case 'available':
      return 'ready';
    case 'downloadable':
      return 'downloadable';
    case 'downloading':
      return 'downloading';
    default:
      return 'unavailable';
  }
}

export async function getEngineStatus(): Promise<EngineStatus> {
  if (typeof LanguageModel === 'undefined') return 'unsupported';
  try {
    return mapAvailability(await LanguageModel.availability());
  } catch {
    return 'unavailable';
  }
}

/**
 * Trigger the Gemini Nano download. Must be called from a user gesture in a
 * visible document (the popup). Resolves when the model is ready.
 */
export async function downloadModel(
  onProgress: (fraction: number) => void
): Promise<void> {
  if (typeof LanguageModel === 'undefined')
    throw new Error('Built-in AI is not available in this Chrome.');
  const session = await LanguageModel.create({
    monitor(m) {
      m.addEventListener('downloadprogress', (e) => onProgress(e.loaded));
    },
  });
  session.destroy();
}

// ---- Sessions ---------------------------------------------------------------

let proofreader: ProofreaderInstance | null | undefined; // undefined = not probed yet
let promptSession: LanguageModelSession | null = null;
let queue: Promise<unknown> = Promise.resolve();

async function getProofreader(): Promise<ProofreaderInstance | null> {
  if (proofreader !== undefined) return proofreader;
  proofreader = null;
  if (typeof Proofreader === 'undefined') return null;
  try {
    const opts = { expectedInputLanguages: ['en'] };
    if ((await Proofreader.availability(opts)) === 'available') {
      proofreader = await Proofreader.create(opts);
    }
  } catch {
    proofreader = null;
  }
  return proofreader;
}

async function getPromptSession(): Promise<LanguageModelSession> {
  if (promptSession) return promptSession;
  if (typeof LanguageModel === 'undefined') throw new Error('unsupported');
  const base = {
    initialPrompts: [{ role: 'system' as const, content: SYSTEM_PROMPT }],
    temperature: 0,
    topK: 1,
  };
  try {
    promptSession = await LanguageModel.create({
      ...base,
      expectedInputs: [{ type: 'text', languages: ['en'] }],
      expectedOutputs: [{ type: 'text', languages: ['en'] }],
    });
  } catch {
    // Older builds reject expectedInputs/temperature combos; retry minimal.
    promptSession = await LanguageModel.create({ initialPrompts: base.initialPrompts });
  }
  return promptSession;
}

/** Drop cached sessions (e.g. after an error) so the next call recreates them. */
export function resetEngine(): void {
  try {
    promptSession?.destroy();
  } catch {
    /* ignore */
  }
  promptSession = null;
  proofreader = undefined;
}

// ---- Chunking ---------------------------------------------------------------

interface Chunk {
  offset: number;
  text: string;
}

const SENTENCE_SPLIT = /(?<=[.!?…])\s+/u;

/** Split on line breaks, then split over-long paragraphs on sentence ends. */
export function chunkText(text: string): Chunk[] {
  const chunks: Chunk[] = [];
  let offset = 0;
  for (const line of text.split('\n')) {
    if (/\p{L}{2}/u.test(line)) {
      if (line.length <= MAX_CHUNK_LENGTH) {
        chunks.push({ offset, text: line });
      } else {
        let cursor = 0;
        let buf = '';
        let bufStart = 0;
        for (const piece of line.split(SENTENCE_SPLIT)) {
          const idx = line.indexOf(piece, cursor);
          if (
            buf &&
            buf.length + (idx - bufStart - buf.length) + piece.length > MAX_CHUNK_LENGTH
          ) {
            chunks.push({ offset: offset + bufStart, text: buf });
            buf = '';
          }
          if (!buf) bufStart = idx;
          buf = line.slice(bufStart, idx + piece.length);
          cursor = idx + piece.length;
        }
        if (buf) chunks.push({ offset: offset + bufStart, text: buf });
      }
    }
    offset += line.length + 1;
  }
  return chunks;
}

// ---- Classification ---------------------------------------------------------

const stripPunct = (s: string) => s.replace(/[^\p{L}\p{N}\s]/gu, '');

export function classify(original: string, replacement: string): CorrectionType {
  const o = original.trim();
  const r = replacement.trim();
  if (o.toLowerCase() === r.toLowerCase()) return 'capitalization';
  if (stripPunct(o).toLowerCase() === stripPunct(r).toLowerCase()) return 'punctuation';
  const ow = o.split(/\s+/);
  const rw = r.split(/\s+/);
  if (rw.length > ow.length) return 'missing-words';
  if (ow.length === 1 && rw.length === 1) {
    return editDistance(o.toLowerCase(), r.toLowerCase()) <=
      Math.max(2, Math.floor(o.length / 3))
      ? 'spelling'
      : 'grammar';
  }
  return 'grammar';
}

function editDistance(a: string, b: string): number {
  const prev = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(
        prev[j] + 1,
        prev[j - 1] + 1,
        diag + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      diag = tmp;
    }
  }
  return prev[b.length];
}

function normalizeProofreaderType(t: string | undefined): CorrectionType {
  switch ((t || '').toLowerCase()) {
    case 'spelling':
    case 'punctuation':
    case 'capitalization':
    case 'preposition':
      return t!.toLowerCase() as CorrectionType;
    case 'missing-words':
    case 'missingwords':
      return 'missing-words';
    default:
      return 'grammar';
  }
}

// ---- Proofreading -----------------------------------------------------------

async function proofreadChunkWithProofreader(
  pr: ProofreaderInstance,
  chunk: Chunk
): Promise<Correction[]> {
  const result = await pr.proofread(chunk.text);
  return result.corrections
    .filter((c) => c.endIndex > c.startIndex || c.correction.length > 0)
    .map((c) => ({
      start: chunk.offset + c.startIndex,
      end: chunk.offset + c.endIndex,
      original: chunk.text.slice(c.startIndex, c.endIndex),
      replacement: c.correction,
      type: normalizeProofreaderType(c.type),
      explanation: c.explanation,
    }));
}

function parseCorrected(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as { corrected?: unknown };
    if (typeof parsed.corrected === 'string') return parsed.corrected;
  } catch {
    /* fall through */
  }
  // Some builds ignore the schema; salvage a bare string reply.
  const m = raw.match(/"corrected"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (m) {
    try {
      return JSON.parse('"' + m[1] + '"') as string;
    } catch {
      return null;
    }
  }
  return null;
}

async function proofreadChunkWithPrompt(chunk: Chunk): Promise<Correction[]> {
  const base = await getPromptSession();
  let session = base;
  let owned = false;
  try {
    session = await base.clone();
    owned = true;
  } catch {
    /* clone unsupported; share the base session */
  }
  try {
    const raw = await session.prompt(`Proofread this text:\n\n${chunk.text}`, {
      responseConstraint: RESPONSE_SCHEMA,
    });
    const corrected = parseCorrected(raw);
    if (corrected === null) return [];
    // Chunks never contain line breaks; if the model added some, flatten them.
    const cleaned = corrected.replace(/\r?\n+/g, ' ');
    const edits = diffEdits(chunk.text, cleaned);
    if (changedRatio(chunk.text, edits) > MAX_CHANGED_RATIO) return []; // model rewrote; distrust
    return edits.map((e) => {
      const original = chunk.text.slice(e.start, e.end);
      return {
        start: chunk.offset + e.start,
        end: chunk.offset + e.end,
        original,
        replacement: e.replacement,
        type: classify(original, e.replacement),
      };
    });
  } finally {
    if (owned) session.destroy();
  }
}

/** Proofread `text`, serialized so only one model call is in flight at a time. */
export function proofread(text: string): Promise<ProofreadResult> {
  const run = async (): Promise<ProofreadResult> => {
    const chunks = chunkText(text);
    const pr = await getProofreader();
    const engine: EngineKind = pr ? 'proofreader' : 'prompt';
    const corrections: Correction[] = [];
    for (const chunk of chunks) {
      const found = pr
        ? await proofreadChunkWithProofreader(pr, chunk)
        : await proofreadChunkWithPrompt(chunk);
      corrections.push(...found);
    }
    corrections.sort((a, b) => a.start - b.start);
    return { corrections, engine };
  };
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
}
