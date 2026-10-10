import { appendFileSync, existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { marksFromSpace, parseDecision } from "./action-space"
import { connectCdp } from "./cdp"
import { runNav } from "./loop"
import { writeFieldText } from "./text"
import {
  annotateQuestions,
  DECISION_TIMEOUT_MS,
  decisionBody,
  decisionHeaders,
  providerHasVision,
  type System1Auth,
  VISION_TIMEOUT_MS,
} from "./wire"

function arg(name: string) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? (process.argv[index + 1] ?? "") : ""
}

function emit(body: Record<string, unknown>, code: number) {
  console.log(JSON.stringify(body))
  process.exit(code)
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

function note(home: string, row: Record<string, unknown>) {
  const line = JSON.stringify({ t: new Date().toISOString(), ...row })
  console.error(`system1 ${line}`)
  try {
    appendFileSync(join(home, ".open-bot/system1.log"), `${line}\n`)
  } catch {
    // the nav result still returns if the log cannot be written
  }
}

async function main() {
  const session = arg("--session")
  const goal = arg("--goal")
  const value = arg("--value")
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(session) || !goal) {
    emit(
      {
        status: "error",
        detail: "usage: ob-nav --session SESSION --goal TEXT",
      },
      1,
    )
    return
  }
  const home = process.env.HOME || "/home/agent"
  if (existsSync(join(home, ".open-bot/vnc", `${session}.hold`))) {
    emit(
      {
        status: "held",
        steps: 0,
        detail: "user has this screen. Stop until they say they are done.",
      },
      0,
    )
    return
  }
  const auth = readConfig(home)
  if (!auth) {
    emit({ status: "unconfigured", steps: 0, detail: "no provider" }, 2)
    return
  }
  const portFile = join(home, ".open-bot/cdp", session)
  let port = 0
  try {
    port = Number(readFileSync(portFile, "utf8").trim())
  } catch {
    port = 0
  }
  if (!Number.isInteger(port) || port < 9224 || port > 9231) {
    emit({ status: "error", steps: 0, detail: "no screen" }, 1)
    return
  }
  const driver = await connectCdp(port)
  try {
    const result = await runNav({
      goal,
      extraValues: value ? [value] : [],
      driver,
      writeText: ({ goal: fieldGoal, label, page }) => {
        const url = process.env.OPEN_BOT_LLM_URL ?? ""
        const token = process.env.OPEN_BOT_LLM_TOKEN ?? ""
        if (!url || !token) return Promise.resolve("")
        return writeFieldText({ url, token, goal: fieldGoal, label, page })
      },
      ask: async ({ state, questions, space }) => {
        const started = Date.now()
        let image = ""
        if (providerHasVision(auth.provider) && driver.capture) {
          image = (await driver.capture(marksFromSpace(space))) ?? ""
        }
        const asked = image ? annotateQuestions(questions) : questions
        const images = image
          ? [{ content_type: "image/jpeg" as const, base64: image }]
          : undefined
        const response = await fetch(auth.endpoint, {
          method: "POST",
          headers: decisionHeaders(auth),
          body: JSON.stringify(decisionBody(auth, state, asked, images)),
          signal: AbortSignal.timeout(
            image ? VISION_TIMEOUT_MS : DECISION_TIMEOUT_MS,
          ),
        })
        const ms = Date.now() - started
        const vision = image ? { vision: true } : {}
        if (!response.ok) {
          note(home, { ms, http: response.status, ...vision })
          throw new Error(`decision HTTP ${response.status}`)
        }
        const decision = parseDecision(await response.json(), space)
        if (!decision) {
          note(home, { ms, http: response.status, error: "invalid", ...vision })
          throw new Error("invalid decision")
        }
        note(home, {
          ms,
          http: response.status,
          op: decision.operation,
          conf: Number(decision.confidence.toFixed(2)),
          needs: Number(decision.needsUser.toFixed(2)),
          ...vision,
        })
        return decision
      },
    })
    emit(result, result.status === "error" ? 1 : 0)
  } catch (error) {
    const message = error instanceof Error ? error.message : "navigation failed"
    emit(
      {
        status: "error",
        steps: 0,
        detail: message.replaceAll(auth.endpoint, "endpoint").slice(0, 200),
      },
      1,
    )
  } finally {
    driver.close()
  }
}

if (import.meta.main) {
  await main()
}
