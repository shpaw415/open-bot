---
name: system1
description: Ask the configured System 1 decision model (Laya, Clef, or Jev) structured questions from the shell with ob-system1 — text or an image in, one JSON answer line out. Use for quick picks between options, scores, gating signals, or vision checks on a picture or screenshot that do not need a full chat model.
---

# System 1 CLI (ob-system1)

`ob-system1` asks this desktop's System 1 model — the one behind `ob-nav`, configured on the Config page (Desktop navigation) — for general decisions. It reuses that provider and key; nothing else to set up. Never print or read `~/.config/open-bot/system1-auth.json`.

Ask questions:

```sh
ob-system1 --state "Receipt total is 42.30 CAD, tip line is blank" \
  --choice "Is the tip already filled?" yes no \
  --score "How legible is the receipt?"
```

Ask about an image. Vision works only on the Clef providers (`cloudflare-clef`, `selfhosted-clef`); Jev and Laya reject `--image`:

```sh
ob-system1 --state "Photo of the user's pantry" --image ~/workspace/pantry.jpg \
  --choice "Is the shelf full, half, or empty?" full half empty
```

Pipe the context on stdin instead of `--state`:

```sh
cat page.txt | ob-system1 --choice "Is this a product page?" yes no
```

Output is one JSON line on stdout:

```json
{"ok":true,"provider":"cloudflare-clef","model":"clef","answers":{"q1":{"choice":"yes","confidence":0.94,"valid":true}},"ms":812}
```

Questions are numbered `q1`, `q2`, … in flag order. `valid: false` means the model picked something outside your option list. Exit codes: 0 ok, 1 error, 2 usage, 3 unconfigured. On any failure check `ok` before trusting the answers; `unconfigured` means the desktop has no System 1 provider — say so instead of retrying.

Flags:

- `--state TEXT` — context for the question; piped stdin is used when this is missing
- `--choice "Question?" OPTION OPTION [...]` — pick one of two or more options (repeatable)
- `--score "Question?"` — a 0–1 rating (repeatable)
- `--noul "Question?"` — a yes/no-style signal (repeatable)
- `--image FILE|-` and `--image-base64 B64|-` — jpeg, png, or webp, up to 4 per call; `-` reads stdin (then `--state` is required)
- `--model MODEL` — override for this call (e.g. `clef-flash` for cheap bulk checks)
- `--timeout MS` — default 8 s text, 20 s with images

Rules:

- Use it for decisions, not open-ended writing — it answers the questions you pose, with confidence.
- Plugins may call `ob-system1` from their tools and skills; it depends on the desktop's navigation provider, so handle `unconfigured` gracefully.
- Do not log, paste, or echo image bytes, keys, or auth files.
