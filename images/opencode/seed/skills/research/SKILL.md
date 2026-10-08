---
name: research
description: Research products, prices, or facts across the web when plain search or a fetch fails. Load before multi-source research, price checks, or when a fetch returns 403, 429, 404, a captcha, or a transport error.
---

# Web research

Work down a source ladder instead of guessing which site to try next. One fetch failure is never the end of the task.

## Source ladder

1. Plain fetch (`curl` or Bun) of a source's own product or price pages. Static HTML beats JS-heavy pages.
2. `ob-nav --session SESSION --goal "open <url> and ..."` for JS-heavy or bot-guarded pages. The real browser clears what plain fetch cannot.
3. `ob-page --session SESSION read` on the loaded page to pull prices and availability from the DOM.
4. The next source on the ladder. Do not fight one site; switch.

## Fetch status handling

- `403` — bot-blocked. Never label the source "verify manually" and stop. Switch to the desktop browser: `ob-nav --session SESSION --goal "open <url>"`, then `ob-page --session SESSION read` for the data.
- `429` — rate limited. Wait once (`sleep 20`), retry once; if still blocked, continue in the desktop browser like a `403`.
- `404` — wrong URL shape. Try the source's search page or a category page; then move on.
- Transport error or timeout — retry once; then move on.
- Captcha or bot-block page in the browser — reload once via `ob-nav`; if it persists, name the source as blocked in the final message and move down the ladder. The desktop browser must get a real try first.
- Results unrelated to the query — the source is a bad fit for the domain; move on.

## Rules

- Never report a price or fact without the source you got it from.
- State the currency and the date when prices can drift.
- Two confirmed sources beat five failed attempts; stop the ladder when the answer is confirmed.
- A `403` or `429` is a signal to switch tools, not to stop. The desktop browser is the fallback; use it before calling any source unavailable, and never end a turn with "verify manually" while `ob-nav`/`ob-page` are still unused.
