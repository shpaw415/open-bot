import {
  buildActionSpace,
  buildQuestions,
  buildState,
  type Candidate,
  CONFIDENCE_MIN,
  type Decision,
  goalUrl,
  goalValues,
  type HistoryEntry,
  isBlankPage,
  MAX_STEPS,
  NONE_VALUE,
  pageKey,
  pageNeedsUser,
  type Question,
  type Snapshot,
  sameSite,
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
  fallback?: "vnc"
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
  navigate?(url: string): Promise<void>
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
  const opened = await openGoal(
    opts.driver,
    opts.goal,
    await opts.driver.probe(),
  )
  if ("status" in opened) return opened
  let snapshot = opened
  for (let step = 1; step <= maxSteps; step += 1) {
    if (!isBlankPage(snapshot.url) && pageNeedsUser(snapshot)) {
      return result(snapshot, step, "needs_user", "the page needs the user")
    }
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
        "vnc",
      )
    }
    if (
      decision.needsUser >= CONFIDENCE_MIN &&
      !isBlankPage(snapshot.url) &&
      pageNeedsUser(snapshot)
    ) {
      return result(snapshot, step, "needs_user", "the page needs the user")
    }
    if (decision.needsUser >= CONFIDENCE_MIN && !isBlankPage(snapshot.url)) {
      return result(
        snapshot,
        step,
        "low_confidence",
        "the page does not need the user",
        "vnc",
      )
    }
    if (
      decision.operation !== "BLOCKED" &&
      decision.operation !== "DONE" &&
      decision.confidence < CONFIDENCE_MIN
    ) {
      return result(snapshot, step, "low_confidence", decision.operation, "vnc")
    }
    if (decision.operation === "BLOCKED") {
      return result(snapshot, step, "blocked", "no offered move", "vnc")
    }
    if (decision.operation === "DONE") {
      return result(snapshot, step, "done", snapshot.title || snapshot.url)
    }
    if (decision.operation === "WAIT") {
      waits += 1
      if (waits > 5) {
        return result(
          snapshot,
          step,
          "blocked",
          "the page did not change",
          "vnc",
        )
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
      return result(snapshot, step, "blocked", "missing target", "vnc")
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
  return result(snapshot, maxSteps, "blocked", "step cap", "vnc")
}

async function openGoal(
  driver: Driver,
  goal: string,
  snapshot: Snapshot,
): Promise<Snapshot | NavResult> {
  const target = goalUrl(goal)
  if (isBlankPage(snapshot.url) && !target) {
    return result(snapshot, 0, "blocked", "no url")
  }
  if (
    !target ||
    (!isBlankPage(snapshot.url) && sameSite(snapshot.url, target))
  ) {
    return snapshot
  }
  if (!driver.navigate) {
    return result(snapshot, 0, "error", "cannot open url", "vnc")
  }
  await driver.navigate(target)
  snapshot = await driver.probe()
  for (
    let attempt = 0;
    attempt < 8 && (isBlankPage(snapshot.url) || !snapshot.text.trim());
    attempt += 1
  ) {
    await driver.act({ kind: "wait" })
    snapshot = await driver.probe()
  }
  if (isBlankPage(snapshot.url)) {
    return result(snapshot, 0, "error", "page did not load", "vnc")
  }
  return snapshot
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
  fallback?: "vnc",
): NavResult {
  return {
    status,
    steps,
    url: snapshot.url,
    title: snapshot.title,
    detail,
    ...(fallback ? { fallback } : {}),
  }
}
