import { HttpError } from "./http-error"

export const reservedSkillNames = new Set([
  "desktop",
  "cron",
  "cf-ai",
  "shortcut",
  "refine",
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

export type VikingSkillsOptions = {
  deleteWaitMs?: number
  deletePollDelayMs?: number
  confirmAttempts?: number
  confirmPollDelayMs?: number
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
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
        // OpenViking.
        signal: AbortSignal.timeout(60_000),
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
    return isRecord(body) && "result" in body ? body.result : body
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
  // 6-15s on a loaded OpenViking. Poll the conflict within the delete budget;
  // 404 counts as gone (fresh create). Giving up here is what made reinstalls
  // fail their read-back: the swallowed delete left the old skill in place
  // while POST either 409'd or left the stale body visible to the confirm.
  async function deleteWithRetry(name: string) {
    const deadline = Date.now() + deleteWaitMs
    for (let attempt = 0; ; attempt++) {
      try {
        return await call(`/api/v1/skills/${encodeURIComponent(name)}`, {
          method: "DELETE",
        })
      } catch (error) {
        if (!(error instanceof HttpError)) throw error
        if (error.status === 404) return null
        if (error.status !== 409 || Date.now() >= deadline) throw error
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

  // wait:false returns after the files are written; semantic indexing keeps
  // running server-side. Sync waits here were pushing plugin installs past
  // two minutes (and the Skills editor past its timeout) on a loaded
  // OpenViking — and a client timeout during a sync wait still leaves the
  // write committed, so blind retries created duplicates. Reads see the new
  // body immediately (once the delete gate has actually landed), which is
  // what this confirm checks.
  async function confirmSave(input: SkillDetail) {
    // skillBody() trims the stored body, while manifest bodies typically end
    // with a newline — compare normalized or every newline-terminated skill
    // "fails" the confirm forever (the 2026-10-15 install outage).
    const want = input.body.trim()
    for (let attempt = 0; attempt < confirmAttempts; attempt++) {
      if (attempt > 0) await sleep(confirmPollDelayMs)
      try {
        const saved = await get(input.name)
        if (saved.body === want) return
      } catch {
        // not visible yet — poll again
      }
    }
    throw new HttpError(
      502,
      `saved ${input.name}, but the read-back never matched — re-read viking://user skills before retrying (a timeout here does not mean the write failed)`,
      "skill_confirm",
    )
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

    async save(input: SkillDetail, previousName = "") {
      assertSkillInput(input)
      if (previousName && previousName !== input.name) {
        const previousError = skillNameError(previousName)
        if (previousError) throw new HttpError(400, previousError, "skill_name")
      }
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
        await call("/api/v1/skills", { method: "POST", body: payload })
        try {
          await deleteWithRetry(previousName)
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
        // DELETE + POST is the same replace through the fast paths. The
        // delete must actually land before the POST: swallowing a 409 here
        // left the old skill serving stale content to the confirm below.
        try {
          await deleteWithRetry(input.name)
        } catch (error) {
          throw indexingError(input.name, error)
        }
        await call("/api/v1/skills", { method: "POST", body: payload })
      }
      await confirmSave(input)
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
