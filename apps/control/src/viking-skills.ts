import { HttpError } from "./http-error"

export const reservedSkillNames = new Set([
  "desktop",
  "cron",
  "cf-ai",
  "shortcut",
  "refine",
  // Seed skill that teaches ob-skill itself — a custom skill with this
  // name would shadow the tooling docs in every catalog.
  "skill",
])
const skillNamePattern = /^[A-Za-z0-9_-]{1,64}$/
const maxDescription = 1024
const maxBody = 64 * 1024

export type SkillSummary = {
  name: string
  description: string
}

export type SkillDetail = SkillSummary & {
  body: string
}

type FetchLike = typeof fetch

// Field data 2026-10-15: OpenViking answers 409 on DELETE/POST while its
// background semantic indexing still holds a just-written skill, and the
// window on a loaded server is 6-15s (once seen: 15s+). Writes themselves
// land instantly (wait:false) — only the delete gate needs patience.
const DEFAULT_DELETE_WAIT_MS = 40_000
const DEFAULT_DELETE_POLL_DELAY_MS = 1_000
const DEFAULT_CONFIRM_ATTEMPTS = 12
const DEFAULT_CONFIRM_POLL_DELAY_MS = 1_000
// Field 2026-11-07: a save whose POST already landed must still answer
// within a bounded budget. Stacking the 40 s delete gate and the 12 s
// confirm on top of slow calls read as a hang, agents blind-retried into
// 429s, and a 429'd POST after a landed delete left the skill missing.
const DEFAULT_SAVE_BUDGET_MS = 25_000
const DEFAULT_POST_ATTEMPTS = 3
const DEFAULT_POST_RETRY_DELAY_MS = 1_000

export type VikingSkillsOptions = {
  deleteWaitMs?: number
  deletePollDelayMs?: number
  confirmAttempts?: number
  confirmPollDelayMs?: number
  saveBudgetMs?: number
  postAttempts?: number
  postRetryDelayMs?: number
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

// OpenViking wraps every response in a {status, result, ...} envelope
// (documented in docs/en/api/04-skills.md); legacy builds answered the bare
// payload. unwrapVikingResult is the shared reader — every hand-rolled
// response parse must go through it or it silently reads nothing.
export function unwrapVikingResult(body: unknown): unknown {
  return isRecord(body) && "result" in body ? body.result : body
}

// The skills array from a list response, accepting the current envelope
// ({status:"ok", result:{skills:[...]}}) and the legacy bare shapes
// ({skills:[...]} or a bare array).
export function vikingSkillList(body: unknown): unknown[] {
  const inner = unwrapVikingResult(body)
  if (isRecord(inner) && Array.isArray(inner.skills)) return inner.skills
  if (Array.isArray(inner)) return inner
  return []
}

export function skillNameError(name: string) {
  if (reservedSkillNames.has(name)) return `${name} is a built-in skill`
  if (!skillNamePattern.test(name)) {
    return "name must be 1-64 ASCII letters, numbers, hyphens, or underscores"
  }
  return ""
}

export function assertSkillInput(input: SkillDetail) {
  const nameError = skillNameError(input.name)
  if (nameError) throw new HttpError(400, nameError, "skill_name")
  if (!input.description) {
    throw new HttpError(400, "description is required", "skill_description")
  }
  if (input.description.length > maxDescription) {
    throw new HttpError(400, "description is too long", "skill_description")
  }
  if (input.description.includes("\n")) {
    throw new HttpError(
      400,
      "description must be one line",
      "skill_description",
    )
  }
  if (!input.body.trim()) {
    throw new HttpError(400, "skill body is required", "skill_body")
  }
  if (input.body.length > maxBody) {
    throw new HttpError(400, "skill body is too long", "skill_body")
  }
}

function envelopeMessage(body: unknown) {
  if (!isRecord(body)) return ""
  const error = body.error
  if (typeof error === "string") return error
  if (isRecord(error) && typeof error.message === "string") return error.message
  return ""
}

function skillBody(content: string) {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(content)
  if (!match) return content.trim()
  return content.slice(match[0].length).trim()
}

function isPrivateSkill(uri: string) {
  return uri.startsWith("viking://user/") && uri.includes("/skills/")
}

export function createVikingSkills(
  baseUrl: string,
  apiKey: string,
  fetchImpl: FetchLike = fetch,
  options: VikingSkillsOptions = {},
) {
  const deleteWaitMs = options.deleteWaitMs ?? DEFAULT_DELETE_WAIT_MS
  const deletePollDelayMs =
    options.deletePollDelayMs ?? DEFAULT_DELETE_POLL_DELAY_MS
  const confirmAttempts = options.confirmAttempts ?? DEFAULT_CONFIRM_ATTEMPTS
  const confirmPollDelayMs =
    options.confirmPollDelayMs ?? DEFAULT_CONFIRM_POLL_DELAY_MS
  const saveBudgetMs = options.saveBudgetMs ?? DEFAULT_SAVE_BUDGET_MS
  const postAttempts = options.postAttempts ?? DEFAULT_POST_ATTEMPTS
  const postRetryDelayMs =
    options.postRetryDelayMs ?? DEFAULT_POST_RETRY_DELAY_MS
  const root = baseUrl.replace(/\/$/, "")

  async function call(path: string, init?: RequestInit) {
    let response: Response
    try {
      response = await fetchImpl(`${root}${path}`, {
        ...init,
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          ...init?.headers,
        },
        // Writes return as soon as the files land (wait:false below); reads
        // are fs-backed. The budget is only a safety net for a loaded
        // OpenViking — 20 s keeps one wedged call from stacking into the
        // minute-scale hangs seen in the field.
        signal: AbortSignal.timeout(20_000),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : "request failed"
      throw new HttpError(
        502,
        `desktop OpenViking is not reachable: ${message}`,
        "viking_skills",
      )
    }
    const text = await response.text()
    let body: unknown = null
    if (text) {
      try {
        body = JSON.parse(text)
      } catch {
        body = null
      }
    }
    if (!response.ok || (isRecord(body) && body.status === "error")) {
      throw new HttpError(
        response.ok ? 502 : response.status,
        envelopeMessage(body) ||
          text.slice(0, 300) ||
          "OpenViking skills request failed",
        "viking_skills",
      )
    }
    return unwrapVikingResult(body)
  }

  async function get(name: string): Promise<SkillDetail> {
    const nameError = skillNameError(name)
    if (nameError) throw new HttpError(400, nameError, "skill_name")
    const result = await call(
      `/api/v1/skills/${encodeURIComponent(name)}?include_content=true&include_files=false`,
    )
    const content =
      isRecord(result) && typeof result.content === "string"
        ? result.content
        : ""
    // Newer OpenViking builds split the skill into `content` (full SKILL.md,
    // frontmatter included) and `overview` (the body after the frontmatter).
    // Prefer the stripped content; fall back to overview when content is
    // absent so the read-back keeps working across API shapes.
    const overview =
      isRecord(result) && typeof result.overview === "string"
        ? result.overview
        : ""
    const description =
      isRecord(result) && typeof result.description === "string"
        ? result.description
        : ""
    return { name, description, body: skillBody(content) || overview.trim() }
  }

  function data(input: SkillDetail) {
    return {
      name: input.name,
      description: input.description,
      content: input.body,
    }
  }

  // A skill written seconds ago is still being indexed server-side; DELETE
  // (and POST-over-existing) answer 409 until that settles — observed for
  // 6-15s on a loaded OpenViking. Poll the conflict within the delete budget
  // (never past `deadline` when the caller shares a save budget);
  // 404 counts as gone (fresh create). Giving up here is what made reinstalls
  // fail their read-back: the swallowed delete left the old skill in place
  // while POST either 409'd or left the stale body visible to the confirm.
  async function deleteWithRetry(
    name: string,
    deadline = Number.POSITIVE_INFINITY,
  ) {
    const limit = Math.min(Date.now() + deleteWaitMs, deadline)
    for (let attempt = 0; ; attempt++) {
      try {
        return await call(`/api/v1/skills/${encodeURIComponent(name)}`, {
          method: "DELETE",
        })
      } catch (error) {
        if (!(error instanceof HttpError)) throw error
        if (error.status === 404) return null
        if (error.status !== 409 || Date.now() >= limit) throw error
        await sleep(deletePollDelayMs)
      }
    }
  }

  function indexingError(name: string, error: unknown) {
    if (error instanceof HttpError && error.status === 409) {
      return new HttpError(
        503,
        `${name} is still being indexed by OpenViking — retry in a minute (the 409 clears once indexing settles)`,
        "skill_indexing",
      )
    }
    return error
  }

  function retryablePost(error: unknown) {
    if (!(error instanceof HttpError)) return false
    // 429 = OpenViking rate limit under agent retry storms; 5xx and the 502
    // network wrapper are transient. Other 4xx (validation, name conflict)
    // fail fast — retrying those only burns the budget.
    return error.status === 429 || error.status >= 500
  }

  // POST with a bounded retry for rate limits and transient server errors —
  // the field showed a first-attempt 429 permanently failing a replace whose
  // delete had already landed.
  async function postSkill(payload: string, deadline: number) {
    let lastError: unknown = null
    for (let attempt = 0; attempt < postAttempts; attempt++) {
      if (attempt > 0) await sleep(postRetryDelayMs)
      try {
        return await call("/api/v1/skills", { method: "POST", body: payload })
      } catch (error) {
        lastError = error
        if (!retryablePost(error) || Date.now() >= deadline) throw error
      }
    }
    throw lastError
  }

  // Best-effort pre-delete snapshot of an existing skill: the rollback
  // payload when a same-name replace's POST cannot land. Absent skills (or
  // two failed reads) return null — nothing to roll back to.
  async function snapshotSkill(name: string): Promise<SkillDetail | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await sleep(250)
      try {
        return await get(name)
      } catch {
        // absent or unreadable — try once more, then give up
      }
    }
    return null
  }

  // wait:false returns after the files are written; semantic indexing keeps
  // running server-side, so the read-back can lag a few seconds on a loaded
  // OpenViking. The write is durable the moment POST answers — a lagging
  // read-back is reported as confirmed:false, never as a failure (field
  // 2026-11-07: the 502 here read as "save failed" and triggered the exact
  // blind retries that made things worse).
  async function confirmSave(input: SkillDetail, deadline: number) {
    // skillBody() trims the stored body, while manifest bodies typically end
    // with a newline — compare normalized or every newline-terminated skill
    // "fails" the confirm forever (the 2026-10-15 install outage).
    const want = input.body.trim()
    for (let attempt = 0; attempt < confirmAttempts; attempt++) {
      if (attempt > 0) await sleep(confirmPollDelayMs)
      try {
        const saved = await get(input.name)
        if (saved.body === want) return true
      } catch {
        // not visible yet — poll again
      }
      if (Date.now() >= deadline) return false
    }
    return false
  }

  return {
    async list(): Promise<SkillSummary[]> {
      const result = await call("/api/v1/skills")
      const skills = isRecord(result) ? result.skills : result
      if (!Array.isArray(skills)) return []
      return skills.flatMap((item) => {
        if (!isRecord(item) || typeof item.name !== "string") return []
        const uri =
          typeof item.uri === "string"
            ? item.uri
            : typeof item.root_uri === "string"
              ? item.root_uri
              : ""
        if (!isPrivateSkill(uri)) return []
        return [
          {
            name: item.name,
            description:
              typeof item.description === "string" ? item.description : "",
          },
        ]
      })
    },

    get,

    async save(input: SkillDetail, previousName = ""): Promise<{
      confirmed: boolean
    }> {
      assertSkillInput(input)
      if (previousName && previousName !== input.name) {
        const previousError = skillNameError(previousName)
        if (previousError) throw new HttpError(400, previousError, "skill_name")
      }
      const deadline = Date.now() + saveBudgetMs
      const validated = await call("/api/v1/skills/validate", {
        method: "POST",
        body: JSON.stringify({ data: data(input) }),
      })
      if (isRecord(validated) && validated.valid === false) {
        const errors = Array.isArray(validated.errors) ? validated.errors : []
        const message = errors
          .map((item) =>
            isRecord(item) && typeof item.message === "string"
              ? item.message
              : "",
          )
          .filter(Boolean)
          .join("; ")
        throw new HttpError(400, message || "skill is invalid", "skill_invalid")
      }
      const payload = JSON.stringify({ data: data(input), wait: false })
      if (previousName && previousName !== input.name) {
        // Rename keeps the loss-proof order: the new name lands first, the
        // old one is removed only after — a failure here leaves a duplicate,
        // never a hole.
        await postSkill(payload, deadline)
        try {
          await deleteWithRetry(previousName, deadline)
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "delete failed"
          throw new HttpError(
            502,
            `Saved ${input.name}, but ${previousName} is still there: ${message}`,
            "skill_rename",
          )
        }
      } else {
        // Same-name updates used to go through PUT, which wedges on a loaded
        // OpenViking (no response even at 120 s while POST answers fast).
        // DELETE + POST is the same replace through the fast paths — but the
        // delete landing before a failed POST is the one window where the
        // skill could vanish (field 2026-11-07: a 429'd POST right after a
        // successful delete left the skill missing). Snapshot the current
        // content first and roll it back if the POST cannot land.
        const snapshot = await snapshotSkill(input.name)
        try {
          await deleteWithRetry(input.name, deadline)
        } catch (error) {
          throw indexingError(input.name, error)
        }
        try {
          await postSkill(payload, deadline)
        } catch (error) {
          if (!snapshot) throw error
          const reason =
            error instanceof Error ? error.message : "post failed"
          // Recovery gets a grace past the normal budget — restoring the
          // previous content matters more than answering fast.
          let restored = false
          try {
            await postSkill(
              JSON.stringify({ data: data(snapshot), wait: false }),
              deadline + 5_000,
            )
            restored = true
          } catch {
            // rollback failed too — reported below
          }
          throw new HttpError(
            502,
            restored
              ? `replace of ${input.name} failed (${reason}) — the previous content was restored, retry the save`
              : `replace of ${input.name} failed (${reason}) and restoring the previous content failed too — re-save the skill now`,
            "skill_replace",
          )
        }
      }
      const confirmed = await confirmSave(input, deadline)
      return { confirmed }
    },

    async remove(name: string) {
      const nameError = skillNameError(name)
      if (nameError) throw new HttpError(400, nameError, "skill_name")
      // Uninstalls and install rollbacks go through here; a bare DELETE left
      // orphan skills behind whenever indexing was still holding the name.
      try {
        await deleteWithRetry(name)
      } catch (error) {
        throw indexingError(name, error)
      }
    },
  }
}
