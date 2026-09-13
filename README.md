# Grammafy

Grammar and spelling suggestions in every text box, powered by Chrome's built-in on-device AI (Gemini Nano). No account, no server, no telemetry. Nothing you type ever leaves your computer.

Think Grammarly, minus the cloud.

## How it works

- A content script watches `<textarea>`, `contenteditable` editors (Gmail, Notion, Slack, GitHub…) and optionally single-line inputs.
- About a second after you stop typing, the text is sent to a hidden extension page that hosts a Gemini Nano session and asks it to proofread each paragraph.
- Mistakes are underlined in place. Hover one to see the suggestion, then **Accept** or **Dismiss**. The badge in the corner of the field shows the count and fixes everything at once when clicked.
- When Chrome's [Proofreader API](https://developer.chrome.com/docs/ai/proofreader-api) is available it is used directly. Otherwise the stable [Prompt API](https://developer.chrome.com/docs/extensions/ai/prompt-api) returns a corrected paragraph and Grammafy diffs it against the original to find the edits.

## Requirements

- Chrome 138 or newer (the Prompt API is stable for extensions from 138).
- Hardware that Chrome allows to run Gemini Nano: about 22 GB of free disk on the profile's volume, plus a GPU with more than 4 GB of VRAM or 16 GB of RAM with 4 cores. The popup tells you where you stand and offers the one-time model download.

## Install (developer build)

```sh
pnpm install
pnpm build          # typecheck + bundle to build/ + zip to dist/
```

Then open `chrome://extensions`, enable **Developer mode**, click **Load unpacked** and pick the `build/` folder. Click the Grammafy icon and press **Download model** if Chrome hasn't fetched Gemini Nano yet.

```sh
pnpm watch          # rebuild on change while developing
pnpm test           # unit tests for the diff and offset logic
pnpm icons          # re-rasterize assets/icon.svg (macOS only)
```

## Project layout

- `src/contentScript.ts` – finds editable fields on focus, wires settings.
- `src/field.ts` – per-field controller: debounce, alignment while typing, applying fixes.
- `src/overlay.ts` – underlines, suggestion card and badge, all inside a closed shadow root.
- `src/textmap.ts` – maps text offsets to on-screen rectangles for textareas and contenteditable.
- `src/engine.ts` – Proofreader/Prompt API wrapper, chunking, rewrite guard.
- `src/diff.ts` – token diff that turns a corrected paragraph into minimal edits.
- `src/background.ts` – service worker: routes requests to the offscreen host, caches results.
- `src/offscreen.ts` + `public/offscreen.html` – hidden page that owns the model session.
- `src/popup.ts` + `public/popup.html` – status, model download, toggles and a "try it" box.

## Privacy

The manifest's content security policy sets `connect-src 'none'`: the extension cannot make network requests. The only download is the model itself, which Chrome fetches and manages.

## Opting a field out

Add `data-grammafy="false"` (or `spellcheck="false"`, which code editors already set) to an element to skip it.

## License

MIT
