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
) {
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
        // Skill saves embed server-side and can take minutes on a loaded
        // OpenViking; keep the budget well above that.
        signal: AbortSignal.timeout(240_000),
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

  function data(input: SkillDetail) {
    return {
      name: input.name,
      description: input.description,
      content: input.body,
    }
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

    async get(name: string): Promise<SkillDetail> {
      const nameError = skillNameError(name)
      if (nameError) throw new HttpError(400, nameError, "skill_name")
      const result = await call(
        `/api/v1/skills/${encodeURIComponent(name)}?include_content=true&include_files=false`,
      )
      const content =
        isRecord(result) && typeof result.content === "string"
          ? result.content
          : ""
      const description =
        isRecord(result) && typeof result.description === "string"
          ? result.description
          : ""
      return { name, description, body: skillBody(content) }
    },

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
      // wait:true keeps installs deterministic; the timeout must cover
      // server-side embedding, which can take minutes on a loaded OpenViking.
      const payload = JSON.stringify({
        data: data(input),
        wait: true,
        timeout: 240,
      })
      if (!previousName || previousName !== input.name) {
        await call("/api/v1/skills", { method: "POST", body: payload })
        if (previousName && previousName !== input.name) {
          try {
            await call(`/api/v1/skills/${encodeURIComponent(previousName)}`, {
              method: "DELETE",
            })
          } catch (error) {
            const message =
              error instanceof Error ? error.message : "delete failed"
            throw new HttpError(
              502,
              `Saved ${input.name}, but ${previousName} is still there: ${message}`,
              "skill_rename",
            )
          }
        }
        return
      }
      await call(`/api/v1/skills/${encodeURIComponent(input.name)}`, {
        method: "PUT",
        body: payload,
      })
    },

    async remove(name: string) {
      const nameError = skillNameError(name)
      if (nameError) throw new HttpError(400, nameError, "skill_name")
      await call(`/api/v1/skills/${encodeURIComponent(name)}`, {
        method: "DELETE",
      })
    },
  }
}
