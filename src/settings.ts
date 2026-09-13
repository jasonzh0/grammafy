import { DEFAULT_SETTINGS } from './constants';
import type { Settings } from './types';

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.sync.get({ ...DEFAULT_SETTINGS } as Record<
    string,
    unknown
  >);
  return { ...DEFAULT_SETTINGS, ...(stored as Partial<Settings>) };
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  await chrome.storage.sync.set({ ...patch } as Record<string, unknown>);
}

/** Subscribe to settings changes; returns an unsubscribe function. */
export function onSettingsChange(cb: (next: Settings) => void): () => void {
  const listener = (_changes: unknown, area: string) => {
    if (area === 'sync') void getSettings().then(cb);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
