# Privacy Policy — Token Counter for ChatGPT

Last updated: 15 September 2026

## Summary

This extension does not collect, transmit, sell, or share any personal data.
There is no server, no analytics, and no third-party service of any kind.

## What the extension reads

To count the tokens in your conversation, the extension reads:

- The text of the ChatGPT conversation currently open in your browser tab.
- Responses from chatgpt.com's own internal endpoints that the page has already
  requested, in order to read conversation contents and usage figures.
- The authorization header that the ChatGPT page attaches to its own requests.
  This is held in memory only, is used solely to re-issue requests to
  chatgpt.com on the same origin, and is never stored or sent anywhere else.

All of this happens locally in your browser. Nothing leaves your device.

## What the extension stores

Your display preferences only — context limit, and whether each element is
shown. These are kept in Chrome's extension storage and synced across your own
signed-in Chrome profiles by Chrome itself. They contain no conversation data.

## What the extension sends

Nothing. The extension makes no requests to any domain other than chatgpt.com,
and those requests go only to endpoints the ChatGPT page itself already uses.

## Permissions

- `storage` — to save your display preferences.
- Host access to `chatgpt.com` — required because counting a conversation
  requires reading that conversation. The extension runs on no other site.

## Changes

Any change to this policy will be published with a new version of the extension
and reflected in the date above.

## Contact

Open an issue at https://github.com/DrGenAI/Token-Counter/issues
