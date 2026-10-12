import { readFileSync } from "node:fs"
import {
  askSystem1,
  noteSystem1,
  readSystem1Config,
  System1Error,
} from "./client"
import {
  DECISION_TIMEOUT_MS,
  type DecisionImage,
  providerHasVision,
  VISION_TIMEOUT_MS,
} from "./wire"

const USAGE = `usage: ob-system1 --state TEXT --choice "Question?" OPTION OPTION [OPTION...]
  [--choice ...] [--score "Question?" [LEVEL LEVEL ...]] [--noul "Question?"]
  [--image FILE|-] [--image-base64 B64|-] [--model MODEL] [--timeout MS]

Asks the desktop's configured System 1 model (Laya, Clef, Jev) structured
questions and prints one JSON line:
{"ok":true,"provider":"...","model":"...","answers":{"q1":{"choice":"...","confidence":0.9,"valid":true}},"ms":812}
At least one question is required; --choice needs two or more options. --score
ranks the state on levels: pass 2-10 level labels or none for a default 5-point
scale; the answer's "score" is the level index and "level" its label. Piped
stdin becomes --state when --state is missing. --image - reads image bytes from
stdin (jpeg, png, webp; max 4). Vision needs a Clef provider (cloudflare-clef
or selfhosted-clef); other providers reject --image. --model overrides the
configured model for this call. 429, 5xx, and network errors retry once after
1 s; other HTTP errors fail fast with the server's message. Exit codes:
0 ok (including --help), 1 error, 2 usage, 3 unconfigured.`

export class UsageError extends Error {}

export const DEFAULT_SCORE_LEVELS = [
  "not at all",
  "a little",
  "moderately",
  "very",
  "extremely",
]

type Spec =
  | { kind: "choice"; question: string; options: string[] }
  | { kind: "score"; question: string; levels: string[] }
  | { kind: "noul"; question: string }

type ImageArg = { path?: string; b64?: string }

export type Parsed = {
  state: string
  hasState: boolean
  specs: Spec[]
  images: ImageArg[]
  model: string
  timeout: number
}

export function parseArgs(argv: string[]): Parsed {
  const parsed: Parsed = {
    state: "",
    hasState: false,
    specs: [],
    images: [],
    model: "",
    timeout: 0,
  }
  let index = 0
  while (index < argv.length) {
    const token = argv[index]
    const rest = () => {
      const value = argv[index + 1]
      if (value === undefined)
        throw new UsageError(`missing value for ${token}`)
      index += 1
      return value
    }
    if (token === "--state") {
      if (parsed.hasState) {
        throw new UsageError("--state given more than once")
      }
      parsed.state = rest()
      parsed.hasState = true
    } else if (token === "--choice") {
      const question = rest()
      const options: string[] = []
      while (index + 1 < argv.length && !argv[index + 1].startsWith("--")) {
        options.push(argv[index + 1])
        index += 1
      }
      if (options.length < 2) {
        throw new UsageError(`--choice needs at least 2 options: ${question}`)
      }
      parsed.specs.push({ kind: "choice", question, options })
    } else if (token === "--score") {
      const question = rest()
      const levels: string[] = []
      while (index + 1 < argv.length && !argv[index + 1].startsWith("--")) {
        levels.push(argv[index + 1])
        index += 1
      }
      if (levels.length === 0) levels.push(...DEFAULT_SCORE_LEVELS)
      if (levels.length > 10) {
        throw new UsageError("--score takes at most 10 levels")
      }
      parsed.specs.push({ kind: "score", question, levels })
    } else if (token === "--noul") {
      parsed.specs.push({ kind: "noul", question: rest() })
    } else if (token === "--image") {
      parsed.images.push({ path: rest() })
    } else if (token === "--image-base64") {
      parsed.images.push({ b64: rest() })
    } else if (token === "--model") {
      parsed.model = rest()
    } else if (token === "--timeout") {
      const value = Number(rest())
      if (!Number.isFinite(value) || value <= 0) {
        throw new UsageError("--timeout must be milliseconds")
      }
      parsed.timeout = value
    } else {
      throw new UsageError(`unknown argument: ${token}`)
    }
    index += 1
  }
  if (parsed.images.length > 4) throw new UsageError("max 4 images per call")
  return parsed
}

export function buildCliQuestions(specs: Spec[]) {
  const questions: Record<string, unknown> = {}
  specs.forEach((spec, position) => {
    const id = `q${position + 1}`
    if (spec.kind === "choice") {
      questions[id] = {
        type: "choice",
        instructions: spec.question,
        criteria: Object.fromEntries(
          spec.options.map((option) => [option, option]),
        ),
      }
    } else if (spec.kind === "score") {
      questions[id] = {
        type: "score",
        instructions: spec.question,
        criteria: spec.levels,
      }
    } else {
      questions[id] = { type: spec.kind, instructions: spec.question }
    }
  })
  return questions
}

export function sniffImageType(
  bytes: Uint8Array,
): DecisionImage["content_type"] | null {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg"
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png"
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp"
  }
  return null
}

export function normalizeBase64(text: string) {
  const trimmed = text.trim()
  const comma = trimmed.indexOf(",")
  const body =
    trimmed.startsWith("data:") && comma >= 0
      ? trimmed.slice(comma + 1)
      : trimmed
  return body.replace(/\s+/g, "")
}

function loadImages(parsed: Parsed): DecisionImage[] {
  const images: DecisionImage[] = []
  for (const item of parsed.images) {
    let bytes: Buffer
    if (item.path === "-" || item.b64 === "-") {
      if (process.stdin.isTTY) {
        throw new UsageError(
          "--image - / --image-base64 - need the image piped on stdin",
        )
      }
      bytes =
        item.path === "-"
          ? readFileSync(0)
          : Buffer.from(normalizeBase64(readFileSync(0, "utf8")), "base64")
      if (bytes.length === 0) {
        throw new UsageError("no image on stdin; pipe image bytes or base64")
      }
    } else if (item.path) {
      bytes = readFileSync(item.path)
    } else {
      bytes = Buffer.from(normalizeBase64(item.b64 ?? ""), "base64")
    }
    const contentType = sniffImageType(bytes)
    if (!contentType) {
      throw new UsageError(
        `unsupported image, use jpeg, png, or webp${
          item.path && item.path !== "-" ? `: ${item.path}` : ""
        }`,
      )
    }
    images.push({ content_type: contentType, base64: bytes.toString("base64") })
  }
  return images
}

export function decorateAnswers(
  answers: Record<string, unknown>,
  specs: Spec[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  specs.forEach((spec, position) => {
    const id = `q${position + 1}`
    const answer = answers[id]
    if (spec.kind === "choice" && answer && typeof answer === "object") {
      const choice = (answer as { choice?: unknown }).choice
      out[id] = {
        ...(answer as Record<string, unknown>),
        valid: typeof choice === "string" && spec.options.includes(choice),
      }
    } else if (spec.kind === "score" && answer && typeof answer === "object") {
      const raw = Number((answer as { score?: unknown }).score)
      out[id] = {
        ...(answer as Record<string, unknown>),
        level: Number.isFinite(raw)
          ? (spec.levels[
              Math.min(Math.max(Math.round(raw), 0), spec.levels.length - 1)
            ] ?? null)
          : null,
      }
    } else {
      out[id] = answer ?? null
    }
  })
  return out
}

function emit(body: Record<string, unknown>, code: number) {
  console.log(JSON.stringify(body))
  process.exit(code)
}

async function main() {
  const argv = process.argv.slice(2)
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE)
    process.exit(0)
    return
  }
  let parsed: Parsed
  try {
    parsed = parseArgs(argv)
  } catch (error) {
    emit(
      {
        ok: false,
        error: "usage",
        detail: error instanceof Error ? error.message : "bad arguments",
      },
      2,
    )
    return
  }
  const home = process.env.HOME || "/home/agent"
  const auth = readSystem1Config(home)
  if (!auth) {
    emit(
      {
        ok: false,
        error: "unconfigured",
        detail:
          "no System 1 provider; set one on the Config page (Desktop navigation)",
      },
      3,
    )
    return
  }
  const effective = parsed.model ? { ...auth, model: parsed.model } : auth
  if (parsed.images.length > 0 && !providerHasVision(effective.provider)) {
    emit(
      {
        ok: false,
        error: "no_vision",
        detail: `provider ${effective.provider || "unknown"} has no vision; switch to a Clef provider on the Config page or drop --image`,
      },
      1,
    )
    return
  }
  let state = parsed.state
  if (!parsed.hasState) {
    if (parsed.images.some((item) => item.path === "-" || item.b64 === "-")) {
      emit(
        {
          ok: false,
          error: "usage",
          detail: "stdin carries the image; pass --state TEXT",
        },
        2,
      )
      return
    }
    if (!process.stdin.isTTY) {
      try {
        state = readFileSync(0, "utf8").trim()
      } catch {
        state = ""
      }
      if (!state) {
        emit(
          {
            ok: false,
            error: "usage",
            detail: "stdin was empty; pass --state TEXT",
          },
          2,
        )
        return
      }
    }
  }
  if (!state) {
    emit({ ok: false, error: "usage", detail: USAGE }, 2)
    return
  }
  let images: DecisionImage[]
  try {
    images = loadImages(parsed)
  } catch (error) {
    if (error instanceof UsageError) {
      emit({ ok: false, error: "usage", detail: error.message }, 2)
      return
    }
    emit(
      {
        ok: false,
        error: "image",
        detail: error instanceof Error ? error.message : "image failed",
      },
      1,
    )
    return
  }
  const questions = buildCliQuestions(parsed.specs)
  if (Object.keys(questions).length === 0) {
    emit({ ok: false, error: "usage", detail: USAGE }, 2)
    return
  }
  const started = Date.now()
  const timeout =
    parsed.timeout ||
    (images.length > 0 ? VISION_TIMEOUT_MS : DECISION_TIMEOUT_MS)
  try {
    const outcome = await askSystem1(effective, {
      state,
      questions,
      images: images.length > 0 ? images : undefined,
      timeout,
      onAttempt: (attempt) => {
        noteSystem1(home, {
          cli: true,
          ms: attempt.ms,
          http: attempt.http,
          error: attempt.error,
        })
      },
    })
    noteSystem1(home, {
      cli: true,
      ms: outcome.ms,
      http: outcome.http,
      questions: parsed.specs.length,
      images: images.length,
    })
    emit(
      {
        ok: true,
        provider: effective.provider || "unknown",
        model: effective.model || null,
        answers: decorateAnswers(outcome.answers, parsed.specs),
        ms: outcome.ms,
      },
      0,
    )
  } catch (error) {
    const ms = Date.now() - started
    const http = error instanceof System1Error ? error.http : 0
    const message = error instanceof Error ? error.message : "request failed"
    noteSystem1(home, {
      cli: true,
      final: true,
      ms,
      http,
      error: message,
    })
    emit(
      {
        ok: false,
        error: message,
        detail: error instanceof System1Error ? error.detail : undefined,
      },
      1,
    )
  }
}

if (import.meta.main) {
  await main()
}
