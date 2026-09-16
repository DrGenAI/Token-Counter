# Token Counter

A browser extension that shows an approximate token count, context bar and usage
bars on ChatGPT, and exports any conversation to Markdown.

Everything runs locally. No servers, no analytics, nothing leaves your device.

## Install

**From source (Chrome, Edge, Brave, Arc)**

1. Download the latest zip from [Releases](https://github.com/DrGenAI/Token-Counter/releases),
   or clone this repo
2. Go to `chrome://extensions` and turn on **Developer mode**
3. **Load unpacked**, then select the folder containing `manifest.json`

Chrome Web Store listing: pending review.

## What it does

**Token count** beside the conversation title, with a bar against your context
limit. Counting uses the real `o200k_base` byte-pair encoding, not a character
estimate, and follows the active branch of the conversation so edited and
regenerated turns are excluded.

**Usage bars** along the bottom of the message box, showing session and weekly
consumption with reset countdowns. Amber past 75 percent, red past 90 percent.
Each bar carries a pace marker showing how far through the rolling window you
are: if the fill sits ahead of the marker, you are spending faster than the
window refills. A refresh button re-queries on demand.

**Export** saves the conversation as Markdown.

**Cache timer** appears only if ChatGPT exposes a real cache expiry. At time of
writing it does not, so the timer stays hidden rather than showing a guess.

Settings live in the toolbar popup: context limit, and a toggle per element.

## Accuracy

Counts are a floor, not a total. They exclude the hidden system prompt, tool
definitions, memory injections and attachments, so the true figure is higher.

The default 128k context limit is a placeholder — OpenAI does not publish a
stable per-tier figure. Set your own in the popup.

## How it works

```
src/inject.js            main world — patches fetch and XHR, decodes the SSE
                         stream, reads the page's own auth header, emits events
src/tokenizer.bundle.js  vendored gpt-tokenizer, o200k_base only (MIT)
src/content.js           isolated world — counts tokens, injects the UI
popup/                   settings
tools/build.sh           rebuilds the tokenizer and packages a release zip
```

The interceptor re-emits what the page already received; it never contacts any
origin other than `chatgpt.com`. The authorization header is held in memory so
the extension can re-issue same-origin requests, and is never stored or sent
anywhere.

Both known ChatGPT stream shapes are handled: the legacy cumulative `parts[0]`
form, and the newer `{p, o, v}` patch encoding with implicit paths. Unrecognised
events are ignored rather than thrown. If the conversation JSON never arrives,
a fallback counts the rendered turns via `[data-message-author-role]`.

## When it breaks

It will. The extension depends on internal endpoints and DOM structure that
OpenAI changes without notice — the Codex usage route moved from
`/api/codex/usage` to `/backend-api/wham/usage` in April 2026.

Everything fragile is grouped in two places:

- `ENDPOINTS` at the top of `src/inject.js`
- `HEADER_ANCHORS`, `HEADER_LEFT` and `COMPOSER_AFTER` in `src/content.js`

Turn on **Console diagnostics** in the popup and the extension logs where it
mounted, which endpoint answered, and any cache- or limit-shaped fields it found
in intercepted payloads. Paste that into an issue and the fix is usually a
one-line edit.

## Building

```bash
bash tools/build.sh
```

Reinstalls `gpt-tokenizer`, rebuilds `src/tokenizer.bundle.js`, and writes
`dist/token-counter-<version>.zip`. The bundle is deliberately **not** minified:
Chrome Web Store review treats large minified blobs as unreadable code.

## Browser support

| Browser | Status |
| --- | --- |
| Chrome, Edge, Brave, Arc | Works as-is |
| Firefox | Needs `browser_specific_settings`, and `"world": "MAIN"` is not supported the same way — the injector goes in via a script tag |
| Safari | Needs Xcode wrapping and an Apple developer account |

## Privacy

See [PRIVACY.md](PRIVACY.md). Short version: the extension stores your display
settings and nothing else, and transmits nothing to anyone.

## Licence

MIT. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Not affiliated with, endorsed by, or sponsored by OpenAI. ChatGPT is a trademark
of OpenAI.
