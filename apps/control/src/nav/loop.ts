import {
  type ActionSpace,
  buildActionSpace,
  buildQuestions,
  buildState,
  type Candidate,
  CONFIDENCE_MIN,
  type Decision,
  goalUrl,
  goalValues,
  type HistoryEntry,
  hostOf,
  isBlankPage,
  MAX_STEPS,
  type NavMark,
  NEAR_MISS_MARGIN,
  NONE_VALUE,
  pageIsError,
  pageKey,
  pageNeedsUser,
  type Question,
  SCROLL_CONFIDENCE_MIN,
  type Snapshot,
  sameUrl,
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
  requested_url?: string
  motive?: "redirect"
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
  capture?(marks: NavMark[]): Promise<string | null>
}

export type Ask = (input: {
  state: string
  questions: Record<string, Question>
  space: ReturnType<typeof buildActionSpace>
}) => Promise<Decision>

export const DECISION_FAILS = 3

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

export async function runNav(opts: {
  goal: string
  extraValues?: string[]
  ask: Ask
  driver: Driver
  maxSteps?: number
  writeText?: (input: {
    goal: string
    label: string
    page: string
  }) => Promise<string>
}): Promise<NavResult> {
  const maxSteps = opts.maxSteps ?? MAX_STEPS
  // System 1 never solves captchas: a captcha-solving goal is refused
  // before any navigation or screen interaction.
  if (/\bcaptcha/i.test(opts.goal)) {
    return result(
      blankSnapshot,
      0,
      "needs_user",
      "ob-nav never solves captchas. Bring the page to the user instead.",
    )
  }
  const history: HistoryEntry[] = []
  let waits = 0
  let fails = 0
  let scrolledBlocked = false
  const excluded = new Set<string>()
  const visitedY = new Set<number>()
  const target = goalUrl(opts.goal)
  let opened: Opened | NavResult
  try {
    opened = await openGoal(opts.driver, opts.goal, await opts.driver.probe())
  } catch (error) {
    return {
      ...result(blankSnapshot, 0, "error", driverMessage(error), "vnc"),
      ...(target ? { requested_url: target } : {}),
    }
  }
  if ("status" in opened) return opened
  let snapshot = opened.snapshot
  const requested = opened.requested
  const redirected = opened.redirected
  // The navigation URL is a destination, never a field value: drop it from
  // the typing pool so --url runs infer real field text instead of typing
  // the URL into search boxes.
  const values = goalValues(opts.goal, opts.extraValues ?? []).filter(
    (value) => value !== requested,
  )
  let retried = false
  const exit = (
    snap: Snapshot,
    step: number,
    status: NavStatus,
    detail: string,
    fallback?: "vnc",
  ): NavResult => ({
    ...result(snap, step, status, detail, fallback),
    ...(requested ? { requested_url: requested } : {}),
    ...(requested && redirected && hostOf(snap.url) !== hostOf(requested)
      ? { motive: "redirect" }
      : {}),
  })
  // Goal words come from the goal text BEFORE the --url fold: for hop goals
  // the start page's own slug words would otherwise match its own title.
  const unfoldedGoal = requested ? opts.goal.replace(requested, " ") : opts.goal
  const goalWords = new Set(
    unfoldedGoal
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3),
  )
  const titleArrived = (snap: Snapshot) => {
    if (!history.some((h) => h.kind === "click" && h.pageChanged)) return null
    const title = snap.title.split(/ [-—–|] /)[0]
    const words = title
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3)
    return words.length > 0 && words.every((w) => goalWords.has(w))
      ? result(snap, step, "done", snap.title || snap.url)
      : null
  }
  // A server-side redirect or a stray handoff can leave the run on a host the
  // goal never named. One re-navigation to the goal url, then give up for real.
  const retryGoal = async (snap: Snapshot): Promise<Snapshot | null> => {
    if (retried || !requested || !opts.driver.navigate) return null
    if (hostOf(snap.url) === hostOf(requested)) return null
    retried = true
    fails = 0
    await opts.driver.navigate(requested)
    return opts.driver.probe()
  }
  // Sitting on the exact goal-named URL is objective arrival — but only for
  // pure-open goals. For hop goals requested is the --url START page, and a
  // dead hop that never left it must not read as success.
  const openOnlyGoal = (() => {
    if (!requested) return false
    const residual = opts.goal
      .replace(requested, " ")
      .replace(/\b(open|go to|visit|navigate to|load|jump to|browse)\b/gi, " ")
      .replace(/[^a-zA-Z0-9]/g, "")
    return residual.length === 0
  })()
  const arrivedExit = (snap: Snapshot, atStep: number) => {
    if (requested && openOnlyGoal && sameUrl(snap.url, requested)) {
      return result(snap, atStep, "done", snap.title || snap.url)
    }
    return null
  }
  // A page-world throw (bot-wall script, torn-down context) must hand off with
  // a usable message instead of aborting the run as a bare "Uncaught".
  let step = 0
  try {
    for (step = 1; step <= maxSteps; step += 1) {
      if (!isBlankPage(snapshot.url) && pageNeedsUser(snapshot)) {
        return result(snapshot, step, "needs_user", "the page needs the user")
      }
      if (!isBlankPage(snapshot.url) && pageIsError(snapshot)) {
        return exit(
          snapshot,
          step,
          "blocked",
          snapshot.title
            ? `error page: ${snapshot.title.slice(0, 100)}`
            : "error page",
          "vnc",
        )
      }
      const space = buildActionSpace(snapshot, history)
      pruneExcluded(space, excluded)
      let decision: Decision
      try {
        const ask = () =>
          opts.ask({
            state: buildState(space, snapshot, history, opts.goal),
            questions: buildQuestions(space, opts.goal, values),
            space,
          })
        try {
          decision = await ask()
        } catch {
          await sleep(1000)
          decision = await ask()
        }
      } catch (error) {
        return result(
          snapshot,
          step,
          "error",
          error instanceof Error ? error.message : "decision failed",
          "vnc",
        )
      }
      if (decision.needsUser >= CONFIDENCE_MIN && !isBlankPage(snapshot.url)) {
        if (pageNeedsUser(snapshot)) {
          return result(snapshot, step, "needs_user", "the page needs the user")
        }
        fails += 1
        if (decision.target) {
          excluded.add(`${decision.operation}:${decision.target}`)
        }
        if (fails >= DECISION_FAILS) {
          const retry = await retryGoal(snapshot)
          if (retry) {
            snapshot = retry
            continue
          }
          const arrived = arrivedExit(snapshot, step) ?? titleArrived(snapshot)
          if (arrived) return arrived
          return exit(
            snapshot,
            step,
            "low_confidence",
            redirected
              ? `redirected to ${hostOf(snapshot.url) || snapshot.url}`
              : "false handoff",
            "vnc",
          )
        }
        continue
      }
      const reversible =
        decision.operation === "SCROLL_DOWN" ||
        decision.operation === "SCROLL_UP" ||
        decision.operation === "WAIT"
      // DONE claims the whole goal; a low-confidence DONE is a false success,
      // the worst failure mode, so it keeps the full bar and no near-miss.
      const floor =
        decision.operation === "DONE"
          ? CONFIDENCE_MIN
          : reversible
            ? SCROLL_CONFIDENCE_MIN
            : CONFIDENCE_MIN - NEAR_MISS_MARGIN
      if (decision.operation !== "BLOCKED" && decision.confidence < floor) {
        fails += 1
        if (decision.target) {
          excluded.add(`${decision.operation}:${decision.target}`)
        }
        if (fails >= DECISION_FAILS) {
          const retry = await retryGoal(snapshot)
          if (retry) {
            snapshot = retry
            continue
          }
          const arrived = arrivedExit(snapshot, step) ?? titleArrived(snapshot)
          if (arrived) return arrived
          return exit(
            snapshot,
            step,
            "low_confidence",
            decision.operation,
            "vnc",
          )
        }
        continue
      }
      if (decision.operation === "BLOCKED") {
        fails += 1
        if (snapshot.canScrollDown && !scrolledBlocked) {
          scrolledBlocked = true
          await opts.driver.act({ kind: "scroll", direction: "down" })
          snapshot = await opts.driver.probe()
          continue
        }
        if (fails >= DECISION_FAILS) {
          const retry = await retryGoal(snapshot)
          if (retry) {
            snapshot = retry
            continue
          }
          const arrived = arrivedExit(snapshot, step) ?? titleArrived(snapshot)
          if (arrived) return arrived
          return exit(snapshot, step, "blocked", "no offered move", "vnc")
        }
        continue
      }
      const nearMiss =
        !reversible &&
        decision.operation !== "BLOCKED" &&
        decision.operation !== "DONE" &&
        decision.confidence < CONFIDENCE_MIN
      if (!nearMiss && !reversible && decision.operation !== "TYPE_TEXT") {
        fails = 0
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
        let text = typedValue(decision, values)
        if (!text && opts.writeText) {
          text = await opts
            .writeText({
              goal: opts.goal,
              label: candidate?.label || "",
              page: snapshot.text,
            })
            .catch(() => "")
        }
        if (!text) {
          return {
            ...result(
              snapshot,
              step,
              "need_text",
              candidate?.label || "field",
              "vnc",
            ),
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
        const pageChanged = pageKey(snapshot) !== before
        history.push({
          action: candidate?.label || text,
          kind: "type",
          pageChanged,
        })
        // A near-miss that visibly did something cools the counter; one that
        // changed nothing warms it. Same for a full-confidence TYPE that
        // changed nothing: repeating a dead keystroke is thrash.
        if (!pageChanged) {
          fails += 1
          if (fails >= DECISION_FAILS) {
            const arrived =
              arrivedExit(snapshot, step) ?? titleArrived(snapshot)
            if (arrived) return arrived
            return exit(
              snapshot,
              step,
              "low_confidence",
              decision.operation,
              "vnc",
            )
          }
        } else {
          fails = 0
        }
        continue
      }
      const before = pageKey(snapshot)
      const action = actFor(decision.operation, candidate)
      const scrolling =
        decision.operation === "SCROLL_DOWN" ||
        decision.operation === "SCROLL_UP"
      const beforeY = scrolling ? (snapshot.scrollY ?? -1) : -1
      if (scrolling && beforeY >= 0) visitedY.add(Math.round(beforeY / 64))
      try {
        await opts.driver.act(action)
      } catch (error) {
        const message = error instanceof Error ? error.message : ""
        if (!/target covered/i.test(message) || !decision.target) throw error
        // The element sat behind a transient overlay: re-probe the fresh
        // page, drop the covered target, and let the model re-decide.
        excluded.add(`${decision.operation}:${decision.target}`)
        snapshot = await opts.driver.probe()
        const arrived = arrivedExit(snapshot, step) ?? titleArrived(snapshot)
        if (arrived) return arrived
        continue
      }
      snapshot = await opts.driver.probe()
      const pageChanged = pageKey(snapshot) !== before
      if (scrolling) {
        let scrollProgress = false
        if (beforeY >= 0 && snapshot.scrollY !== undefined) {
          const cell = Math.round(snapshot.scrollY / 64)
          scrollProgress =
            Math.abs(snapshot.scrollY - beforeY) >= 8 && !visitedY.has(cell)
          if (scrollProgress) visitedY.add(cell)
        }
        if (!scrollProgress) {
          // Scrolling in place or revisiting territory is thrash, not progress.
          fails += 1
          if (fails >= DECISION_FAILS) {
            const retry = await retryGoal(snapshot)
            if (retry) {
              snapshot = retry
              continue
            }
            const arrived =
              arrivedExit(snapshot, step) ?? titleArrived(snapshot)
            if (arrived) return arrived
            return exit(
              snapshot,
              step,
              "low_confidence",
              "scroll made no progress",
              "vnc",
            )
          }
        } else {
          fails = 0
        }
      }
      history.push({
        action: candidate?.label || decision.operation,
        kind:
          decision.operation === "CLICK"
            ? "click"
            : decision.operation.toLowerCase(),
        pageChanged,
      })
      if (nearMiss) {
        // A near-miss that navigated did its job; one that changed nothing
        // warms the counter toward the fallback handoff.
        if (pageChanged) {
          fails = 0
        } else {
          fails += 1
          if (fails >= DECISION_FAILS) {
            const arrived =
              arrivedExit(snapshot, step) ?? titleArrived(snapshot)
            if (arrived) return arrived
            return exit(
              snapshot,
              step,
              "low_confidence",
              decision.operation,
              "vnc",
            )
          }
        }
      }
    }
  } catch (error) {
    const arrived = openOnlyGoal ? arrivedExit(snapshot, step) : null
    if (arrived) return arrived
    return exit(snapshot, step, "blocked", driverMessage(error), "vnc")
  }
  return exit(snapshot, maxSteps, "blocked", "step cap", "vnc")
}

type Opened = {
  snapshot: Snapshot
  requested: string
  redirected: boolean
}

async function openGoal(
  driver: Driver,
  goal: string,
  snapshot: Snapshot,
): Promise<Opened | NavResult> {
  const target = goalUrl(goal)
  if (isBlankPage(snapshot.url) && !target) {
    return result(snapshot, 0, "blocked", "no url")
  }
  if (
    !target ||
    (!isBlankPage(snapshot.url) && sameUrl(snapshot.url, target))
  ) {
    return { snapshot, requested: target, redirected: false }
  }
  if (!driver.navigate) {
    return {
      ...result(snapshot, 0, "error", "cannot open url", "vnc"),
      ...(target ? { requested_url: target } : {}),
    }
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
    return {
      ...result(snapshot, 0, "error", "page did not load", "vnc"),
      ...(target ? { requested_url: target } : {}),
    }
  }
  return {
    snapshot,
    requested: target,
    redirected: hostOf(snapshot.url) !== hostOf(target),
  }
}

function pruneExcluded(space: ActionSpace, excluded: Set<string>) {
  for (const [operation, head] of Object.entries(space.heads)) {
    for (const key of Object.keys(head)) {
      const candidate = head[key]
      if (
        excluded.has(`${operation}:${key}`) ||
        excluded.has(`${operation}:${candidate.targetId}`)
      ) {
        delete head[key]
      }
    }
    if (Object.keys(head).length === 0) {
      delete space.heads[operation]
      space.operations = space.operations.filter((item) => item !== operation)
    }
  }
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

function driverMessage(error: unknown) {
  return error instanceof Error ? error.message : "screen did not respond"
}

const blankSnapshot: Snapshot = {
  url: "",
  title: "",
  text: "",
  canScrollDown: false,
  canScrollUp: false,
  elements: [],
}
