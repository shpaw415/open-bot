import {
  buildActionSpace,
  buildQuestions,
  buildState,
  type Candidate,
  CONFIDENCE_MIN,
  type Decision,
  goalValues,
  type HistoryEntry,
  MAX_STEPS,
  NONE_VALUE,
  pageKey,
  type Question,
  type Snapshot,
} from "./action-space"

export type NavStatus =
  | "done"
  | "blocked"
  | "low_confidence"
  | "needs_user"
  | "need_text"
  | "error"

export type NavResult = {
  status: NavStatus
  steps: number
  url: string
  title: string
  detail: string
  field?: string
}

export type Act =
  | { kind: "click"; targetId: string }
  | { kind: "type"; targetId: string; text: string }
  | { kind: "enter"; targetId: string }
  | { kind: "select"; targetId: string; label: string }
  | { kind: "scroll"; direction: "up" | "down" }
  | { kind: "wait" }

export type Driver = {
  probe(): Promise<Snapshot>
  act(action: Act): Promise<void>
}

export type Ask = (input: {
  state: string
  questions: Record<string, Question>
  space: ReturnType<typeof buildActionSpace>
}) => Promise<Decision>

export async function runNav(opts: {
  goal: string
  extraValues?: string[]
  ask: Ask
  driver: Driver
  maxSteps?: number
}): Promise<NavResult> {
  const values = goalValues(opts.goal, opts.extraValues ?? [])
  const maxSteps = opts.maxSteps ?? MAX_STEPS
  const history: HistoryEntry[] = []
  let waits = 0
  let snapshot = await opts.driver.probe()
  for (let step = 1; step <= maxSteps; step += 1) {
    const space = buildActionSpace(snapshot, history)
    let decision: Decision
    try {
      decision = await opts.ask({
        state: buildState(space, snapshot, history, opts.goal),
        questions: buildQuestions(space, opts.goal, values),
        space,
      })
    } catch (error) {
      return result(
        snapshot,
        step,
        "error",
        error instanceof Error ? error.message : "decision failed",
      )
    }
    if (decision.needsUser >= CONFIDENCE_MIN) {
      return result(snapshot, step, "needs_user", "the page needs the user")
    }
    if (
      decision.operation !== "BLOCKED" &&
      decision.operation !== "DONE" &&
      decision.confidence < CONFIDENCE_MIN
    ) {
      return result(snapshot, step, "low_confidence", decision.operation)
    }
    if (decision.operation === "BLOCKED") {
      return result(snapshot, step, "blocked", "no offered move")
    }
    if (decision.operation === "DONE") {
      return result(snapshot, step, "done", snapshot.title || snapshot.url)
    }
    if (decision.operation === "WAIT") {
      waits += 1
      if (waits > 5) {
        return result(snapshot, step, "blocked", "the page did not change")
      }
      await opts.driver.act({ kind: "wait" })
      snapshot = await opts.driver.probe()
      continue
    }
    waits = 0
    const candidate = decision.target
      ? space.heads[decision.operation]?.[decision.target]
      : undefined
    if (
      !candidate &&
      decision.operation !== "SCROLL_DOWN" &&
      decision.operation !== "SCROLL_UP"
    ) {
      return result(snapshot, step, "blocked", "missing target")
    }
    if (decision.operation === "TYPE_TEXT") {
      const text = typedValue(decision, values)
      if (!text) {
        return {
          ...result(snapshot, step, "need_text", candidate?.label || "field"),
          field: candidate?.label || "",
        }
      }
      const before = pageKey(snapshot)
      await opts.driver.act({
        kind: "type",
        targetId: candidate?.targetId ?? "",
        text,
      })
      snapshot = await opts.driver.probe()
      history.push({
        action: candidate?.label || text,
        kind: "type",
        pageChanged: pageKey(snapshot) !== before,
      })
      continue
    }
    const before = pageKey(snapshot)
    await opts.driver.act(actFor(decision.operation, candidate))
    snapshot = await opts.driver.probe()
    history.push({
      action: candidate?.label || decision.operation,
      kind:
        decision.operation === "CLICK"
          ? "click"
          : decision.operation.toLowerCase(),
      pageChanged: pageKey(snapshot) !== before,
    })
  }
  return result(snapshot, maxSteps, "blocked", "step cap")
}

function typedValue(decision: Decision, values: string[]) {
  if (values.length === 0) return ""
  if (decision.textValue && decision.textValue !== NONE_VALUE) {
    return values.includes(decision.textValue) ? decision.textValue : ""
  }
  return values.length === 1 ? values[0] : ""
}

function actFor(operation: string, candidate: Candidate | undefined): Act {
  if (operation === "SCROLL_DOWN") return { kind: "scroll", direction: "down" }
  if (operation === "SCROLL_UP") return { kind: "scroll", direction: "up" }
  if (operation === "PRESS_ENTER") {
    return { kind: "enter", targetId: candidate?.targetId ?? "" }
  }
  if (operation === "SELECT") {
    return {
      kind: "select",
      targetId: candidate?.targetId ?? "",
      label: candidate?.optionLabel ?? "",
    }
  }
  return { kind: "click", targetId: candidate?.targetId ?? "" }
}

function result(
  snapshot: Snapshot,
  steps: number,
  status: NavStatus,
  detail: string,
): NavResult {
  return {
    status,
    steps,
    url: snapshot.url,
    title: snapshot.title,
    detail,
  }
}
