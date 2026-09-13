/**
 * Ambient typings for Chrome's built-in AI APIs (Prompt API and Proofreader API).
 * Only the surface Grammafy uses is declared. See:
 * https://developer.chrome.com/docs/ai/prompt-api
 * https://developer.chrome.com/docs/ai/proofreader-api
 */

type AIAvailability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

interface AIDownloadProgressEvent extends Event {
  loaded: number;
}

interface AICreateMonitor extends EventTarget {
  addEventListener(
    type: 'downloadprogress',
    listener: (event: AIDownloadProgressEvent) => void
  ): void;
}

interface LanguageModelExpected {
  type: 'text' | 'image' | 'audio';
  languages?: string[];
}

interface LanguageModelCreateOptions {
  initialPrompts?: { role: 'system' | 'user' | 'assistant'; content: string }[];
  expectedInputs?: LanguageModelExpected[];
  expectedOutputs?: LanguageModelExpected[];
  temperature?: number;
  topK?: number;
  monitor?: (m: AICreateMonitor) => void;
  signal?: AbortSignal;
}

interface LanguageModelPromptOptions {
  responseConstraint?: object;
  signal?: AbortSignal;
}

interface LanguageModelSession {
  prompt(input: string, options?: LanguageModelPromptOptions): Promise<string>;
  clone(): Promise<LanguageModelSession>;
  destroy(): void;
  readonly inputUsage?: number;
  readonly inputQuota?: number;
}

interface LanguageModelParams {
  defaultTopK: number;
  maxTopK: number;
  defaultTemperature: number;
  maxTemperature: number;
}

declare const LanguageModel:
  | {
      availability(
        options?: Partial<LanguageModelCreateOptions>
      ): Promise<AIAvailability>;
      create(options?: LanguageModelCreateOptions): Promise<LanguageModelSession>;
      params(): Promise<LanguageModelParams | null>;
    }
  | undefined;

interface ProofreaderCorrection {
  startIndex: number;
  endIndex: number;
  correction: string;
  type?: string;
  explanation?: string;
}

interface ProofreaderResult {
  correctedInput: string;
  corrections: ProofreaderCorrection[];
}

interface ProofreaderCreateOptions {
  expectedInputLanguages?: string[];
  monitor?: (m: AICreateMonitor) => void;
  signal?: AbortSignal;
}

interface ProofreaderInstance {
  proofread(input: string): Promise<ProofreaderResult>;
  destroy(): void;
}

declare const Proofreader:
  | {
      availability(options?: ProofreaderCreateOptions): Promise<AIAvailability>;
      create(options?: ProofreaderCreateOptions): Promise<ProofreaderInstance>;
    }
  | undefined;
