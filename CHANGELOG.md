# Changelog

## 0.6.0
- Tokenizer shipped unminified; Chrome Web Store review treats large minified
  blobs as unreadable code.
- Added privacy policy and store listing copy.

## 0.5.0
- Refresh button on the usage strip, with spin state and reduced-motion support.

## 0.4.0
- Usage strip mounts inside the composer, measuring itself and falling back to
  sitting underneath if the pill's layout crushes it.
- Bars stretch to the composer width, meters mirrored to the outer edges.
- Added the pace marker showing position within the rolling window.

## 0.3.0
- Badge appends inside the breadcrumb container rather than as a sibling.
- Composer located structurally by border radius rather than by class name.
- Badge reads `≈447k / 128k limit` once the count passes the configured limit.
- DOM fallback dedupes turns by `data-message-id`.

## 0.2.0
- Badge moved to the left of the header.
- Usage strip no longer adds page height.
- Larger bars.
- DOM fallback counter for threads where the conversation JSON never arrives.

## 0.1.0
- First working build: token count, context bar, export, conditional usage bars
  and cache timer.
