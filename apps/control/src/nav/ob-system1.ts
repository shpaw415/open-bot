import { appendFileSync, readFileSync } from "node:fs"
import { join } from "node:path"
import {
  DECISION_TIMEOUT_MS,
  type DecisionImage,
  decisionBody,
  decisionHeaders,
  providerHasVision,
  type System1Auth,
  unwrapAnswers,
  VISION_TIMEOUT_MS,
} from "./wire"

const USAGE = `usage: ob-system1 --state TEXT --choice "Question?" OPTION OPTION [OPTION...]
  [--choice ...] [--score "Question?"] [--noul "Question?"]
  [--image FILE|-] [--image-base64 B64|-] [--model MODEL] [--timeout MS]

Asks the desktop's configured System 1 model (Laya, Clef, Jev) structured
questions and prints one JSON line:
{"ok":true,"provider":"...","model":"...","answers":{"q1":{"choice":"...","confidence":0.9,"valid":true}},"ms":812}
At least one question is required; --choice needs two or more options. Piped
stdin becomes --state when --state is missing. --image - reads image bytes from
stdin (jpeg, png, webp; max 4). Vision needs a Clef provider (cloudflare-clef
or selfhosted-clef); other providers reject --image. --model overrides the
configured model for this call. Exit codes: 0 ok, 1 error, 2 usage,
3 unconfigured.`

export class UsageError extends Error {}

type Spec =
  | { kind: "choice"; question: string; options: string[] }
  | { kind: "score"; question: string }
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
      parsed.specs.push({ kind: "score", question: rest() })
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
        throw new UsageError("--image - / --image-base64 - need the image piped on stdin")
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
    } else {
      out[id] = answer ?? null
    }
  })
  return out
}

function readConfig(home: string): System1Auth | null {
  try {
    const marker = JSON.parse(
      readFileSync(join(home, ".config/open-bot/system1.json"), "utf8"),
    ) as { endpoint?: string; model?: string; provider?: string }
    if (!marker.endpoint) return null
    let apiKey = ""
    let gatewayToken = ""
    try {
      const auth = JSON.parse(
        readFileSync(join(home, ".config/open-bot/system1-auth.json"), "utf8"),
      ) as { apiKey?: string; gatewayToken?: string }
      apiKey = auth.apiKey ?? ""
      gatewayToken = auth.gatewayToken ?? ""
    } catch {
      apiKey = ""
    }
    return {
      endpoint: marker.endpoint,
      model: marker.model ?? "",
      provider: marker.provider ?? "",
      apiKey,
      gatewayToken,
    }
  } catch {
    return null
  }
}

function emit(body: Record<string, unknown>, code: number) {
  console.log(JSON.stringify(body))
  process.exit(code)
}

function note(home: string, row: Record<string, unknown>) {
  const line = JSON.stringify({
    t: new Date().toISOString(),
    cli: true,
    ...row,
  })
  console.error(`system1 ${line}`)
  try {
    appendFileSync(join(home, ".open-bot/system1.log"), `${line}\n`)
  } catch {
    // the answer still returns if the log cannot be written
  }
}

async function main() {
  const argv = process.argv.slice(2)
  if (argv.includes("--help") || argv.includes("-h")) {
    emit({ ok: false, error: "usage", detail: USAGE }, 2)
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
  const auth = readConfig(home)
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
    if (!process.stdin.isTTY) state = readFileSync(0, "utf8").trim()
  }
  if (!state) {
    emit({ ok: false, error: "usage", detail: USAGE }, 2)
    return
  }
  let images: DecisionImage[]
  try {
    images = loadImages(parsed)
  } catch (error) {
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
  const payload = JSON.stringify(
    decisionBody(
      effective,
      state,
      questions,
      images.length > 0 ? images : undefined,
    ),
  )
  const describe = (message: string) =>
    message.replaceAll(effective.endpoint, "endpoint").slice(0, 200)
  let lastError = ""
  let response: Response | null = null
  for (let attempt = 0; attempt < 2 && !response; attempt += 1) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    try {
      const attemptResponse = await fetch(effective.endpoint, {
        method: "POST",
        headers: decisionHeaders(effective),
        body: payload,
        signal: AbortSignal.timeout(timeout),
      })
      if (attemptResponse.ok) {
        response = attemptResponse
        break
      }
      lastError = `decision HTTP ${attemptResponse.status}`
      note(home, {
        ms: Date.now() - started,
        http: attemptResponse.status,
        error: lastError,
      })
    } catch (error) {
      lastError = error instanceof Error ? error.message : "request failed"
      note(home, { ms: Date.now() - started, http: 0, error: lastError })
    }
  }
  if (!response) {
    emit({ ok: false, error: describe(lastError) }, 1)
    return
  }
  const ms = Date.now() - started
  let raw: unknown
  try {
    raw = await response.json()
  } catch {
    note(home, { ms, http: response.status, error: "invalid json" })
    emit({ ok: false, error: "invalid response" }, 1)
    return
  }
  const answers = unwrapAnswers(raw)
  if (!answers) {
    note(home, { ms, http: response.status, error: "invalid" })
    emit({ ok: false, error: "invalid response" }, 1)
    return
  }
  note(home, {
    ms,
    http: response.status,
    questions: parsed.specs.length,
    images: images.length,
  })
  emit(
    {
      ok: true,
      provider: effective.provider || "unknown",
      model: effective.model || null,
      answers: decorateAnswers(answers, parsed.specs),
      ms,
    },
    0,
  )
}

if (import.meta.main) {
  await main()
}
