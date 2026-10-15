import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { marksFromSpace, parseDecision, withGoalUrl } from "./action-space"
import { connectCdp, readActiveTabId } from "./cdp"
import { askSystem1, noteSystem1, readSystem1Config } from "./client"
import { runNav } from "./loop"
import { writeFieldText } from "./text"
import {
  annotateQuestions,
  DECISION_TIMEOUT_MS,
  providerHasVision,
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

async function main() {
  const session = arg("--session")
  const url = arg("--url")
  const goal = withGoalUrl(arg("--goal"), url)
  const value = arg("--value")
  // System 1 never solves captchas: a captcha-solving goal is refused before
  // any screen interaction, whatever the page shows.
  if (/\bcaptcha/i.test(goal)) {
    emit(
      {
        status: "needs_user",
        steps: 0,
        detail:
          "ob-nav never solves captchas. Bring the page to the user instead.",
      },
      0,
    )
    return
  }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(session) || !goal) {
    emit(
      {
        status: "error",
        detail: "usage: ob-nav --session SESSION --goal TEXT [--url URL]",
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
  const auth = readSystem1Config(home)
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
  const driver = await connectCdp(port, readActiveTabId(session))
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
        let image = ""
        if (providerHasVision(auth.provider) && driver.capture) {
          image = (await driver.capture(marksFromSpace(space))) ?? ""
        }
        const asked = image ? annotateQuestions(questions) : questions
        const images = image
          ? [{ content_type: "image/jpeg" as const, base64: image }]
          : undefined
        const vision = image ? { vision: true } : {}
        const outcome = await askSystem1(auth, {
          state,
          questions: asked,
          images,
          timeout: image ? VISION_TIMEOUT_MS : DECISION_TIMEOUT_MS,
          onAttempt: (attempt) => {
            noteSystem1(home, {
              ms: attempt.ms,
              http: attempt.http,
              error: attempt.error,
              ...vision,
            })
          },
        })
        const decision = parseDecision(outcome.body, space)
        if (!decision) {
          noteSystem1(home, {
            ms: outcome.ms,
            http: outcome.http,
            error: "invalid",
            ...vision,
          })
          throw new Error("invalid decision")
        }
        noteSystem1(home, {
          ms: outcome.ms,
          http: outcome.http,
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
