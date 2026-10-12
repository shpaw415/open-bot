import { appendFileSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import {
  DECISION_TIMEOUT_MS,
  type DecisionImage,
  decisionBody,
  decisionHeaders,
  type System1Auth,
  unwrapAnswers,
} from "./wire"

export type { DecisionImage, System1Auth }

export class System1Error extends Error {
  http: number
  detail?: string

  constructor(http: number, message: string, detail?: string) {
    super(message)
    this.http = http
    this.detail = detail
  }
}

export function readSystem1Config(home: string): System1Auth | null {
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

export function noteSystem1(home: string, row: Record<string, unknown>) {
  const line = JSON.stringify({ t: new Date().toISOString(), ...row })
  console.error(`system1 ${line}`)
  try {
    const dir = join(home, ".open-bot")
    mkdirSync(dir, { recursive: true })
    appendFileSync(join(dir, "system1.log"), `${line}\n`)
  } catch {
    // the caller's answer still returns if the log cannot be written
  }
}

export function redactText(text: string) {
  return text
    .replace(/[Bb]earer\s+[^\s"'\\]+/g, "Bearer [redacted]")
    .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}\b/gi, "[redacted]")
    .replace(
      /((?:api[-_]?key|apikey|token|password|secret|authorization)"?\s*[:=,]\s*)"[^"]*"/gi,
      '$1"[redacted]"',
    )
    .replace(
      /((?:api[-_]?key|apikey|token|password|secret|authorization)\s*[:=]\s*)([A-Za-z0-9+/_-]{8,})/gi,
      "$1[redacted]",
    )
    .slice(0, 240)
}

export type AskInput = {
  state: string
  questions: Record<string, unknown>
  images?: DecisionImage[]
  timeout?: number
  onAttempt?: (attempt: {
    attempt: number
    ms: number
    http: number
    error: string
  }) => void
}

export type AskOutcome = {
  answers: Record<string, unknown>
  body: unknown
  ms: number
  http: number
}

// One shared System 1 call for ob-nav and ob-system1: same body shaping, same
// header set, same retry policy (429/5xx/network once after 1s), same
// envelope unwrap, same redaction on every error path.
export async function askSystem1(
  auth: System1Auth,
  input: AskInput,
  fetchImpl: typeof fetch = fetch,
): Promise<AskOutcome> {
  const started = Date.now()
  const timeout = input.timeout ?? DECISION_TIMEOUT_MS
  const payload = JSON.stringify(
    decisionBody(auth, input.state, input.questions, input.images),
  )
  const describe = (message: string) =>
    message.replaceAll(auth.endpoint, "endpoint").slice(0, 200)
  let lastError = ""
  let lastDetail: string | undefined
  let lastHttp = 0
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    const attemptStart = Date.now()
    try {
      const response = await fetchImpl(auth.endpoint, {
        method: "POST",
        headers: decisionHeaders(auth),
        body: payload,
        signal: AbortSignal.timeout(timeout),
      })
      if (response.ok) {
        let text = ""
        try {
          text = await response.text()
        } catch {
          throw new System1Error(response.status, "invalid response")
        }
        const sniff = `${response.headers.get("content-type") || "unknown content-type"}; body ${redactText(text.slice(0, 120))}`
        let raw: unknown
        try {
          raw = JSON.parse(text)
        } catch {
          throw new System1Error(
            response.status,
            "invalid response",
            `not JSON: ${sniff}`,
          )
        }
        const answers = unwrapAnswers(raw)
        if (!answers) {
          throw new System1Error(
            response.status,
            "invalid response",
            `no answers object: ${sniff}`,
          )
        }
        return {
          answers,
          body: raw,
          ms: Date.now() - started,
          http: response.status,
        }
      }
      lastHttp = response.status
      lastError = `decision HTTP ${response.status}`
      let bodyText = ""
      try {
        bodyText = redactText((await response.text()).trim())
      } catch {
        bodyText = ""
      }
      lastDetail = bodyText || undefined
      input.onAttempt?.({
        attempt,
        ms: Date.now() - attemptStart,
        http: response.status,
        error: lastError,
      })
      // 4xx will not heal after 1 s; only retry 429, 5xx, and network errors.
      if (response.status !== 429 && response.status < 500) {
        throw new System1Error(response.status, lastError, lastDetail)
      }
    } catch (error) {
      if (error instanceof System1Error) {
        if (error.http !== 0 && error.http !== 429 && error.http < 500) {
          throw error
        }
        lastError = error.message
        lastHttp = error.http
        lastDetail = error.detail
        continue
      }
      lastError = error instanceof Error ? error.message : "request failed"
      lastHttp = 0
      lastDetail = undefined
      input.onAttempt?.({
        attempt,
        ms: Date.now() - attemptStart,
        http: 0,
        error: lastError,
      })
    }
  }
  throw new System1Error(lastHttp, describe(lastError), lastDetail)
}
