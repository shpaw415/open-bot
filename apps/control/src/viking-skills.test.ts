import { describe, expect, test } from "bun:test"
import { HttpError } from "./http-error"
import { assertSkillInput, createVikingSkills } from "./viking-skills"

const skill = {
  name: "search-web",
  description: "Search the web for current information",
  body: "# search-web\n\nSearch the web.",
}

function mockFetch(handler: (url: string, init?: RequestInit) => unknown) {
  const calls: { url: string; init?: RequestInit }[] = []
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    const result = handler(url, init)
    if (result instanceof Response) return result
    return Response.json(result)
  }) as typeof fetch
  return { calls, fetchImpl }
}

describe("viking skills", () => {
  test("lists only private user skills", async () => {
    const { calls, fetchImpl } = mockFetch(() => ({
      status: "ok",
      result: {
        skills: [
          {
            name: "search-web",
            description: "Search the web",
            uri: "viking://user/agent/skills/search-web",
          },
          {
            name: "shared",
            description: "Shared",
            uri: "viking://agent/skills/shared",
          },
          { name: "bare", description: "No uri" },
        ],
      },
    }))
    const skills = createVikingSkills(
      "http://10.0.0.2:1933",
      "user-key",
      fetchImpl,
    )
    await expect(skills.list()).resolves.toEqual([
      { name: "search-web", description: "Search the web" },
    ])
    expect(calls[0]?.url).toBe("http://10.0.0.2:1933/api/v1/skills")
    expect(new Headers(calls[0]?.init?.headers).get("x-api-key")).toBe(
      "user-key",
    )
  })

  test("reads the markdown body without frontmatter", async () => {
    const { fetchImpl } = mockFetch(() => ({
      status: "ok",
      result: {
        name: "search-web",
        description: "Search the web",
        content:
          "---\nname: search-web\ndescription: Search the web\n---\n\n# search-web\n",
      },
    }))
    const skills = createVikingSkills("http://viking:1933", "k", fetchImpl)
    await expect(skills.get("search-web")).resolves.toEqual({
      name: "search-web",
      description: "Search the web",
      body: "# search-web",
    })
  })

  test("rejects invalid skills before creating them", async () => {
    const { calls, fetchImpl } = mockFetch((url) => {
      if (url.endsWith("/validate")) {
        return {
          status: "ok",
          result: {
            valid: false,
            errors: [{ message: "description is required" }],
          },
        }
      }
      return { status: "ok", result: {} }
    })
    const skills = createVikingSkills("http://viking:1933", "k", fetchImpl)
    await expect(skills.save({ ...skill, description: "ok" })).rejects.toThrow(
      "description is required",
    )
    expect(calls.map((call) => call.url)).toEqual([
      "http://viking:1933/api/v1/skills/validate",
    ])
  })

  test("creates a skill and waits for indexing", async () => {
    const { calls, fetchImpl } = mockFetch(() => ({
      status: "ok",
      result: { valid: true },
    }))
    const skills = createVikingSkills("http://viking:1933/", "k", fetchImpl)
    await skills.save(skill)
    expect(calls[1]?.init?.method).toBe("POST")
    expect(calls[1]?.url).toBe("http://viking:1933/api/v1/skills")
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({
      data: {
        name: "search-web",
        description: skill.description,
        content: skill.body,
      },
      wait: true,
      timeout: 240,
    })
  })

  test("updates a skill in place", async () => {
    const { calls, fetchImpl } = mockFetch(() => ({
      status: "ok",
      result: { valid: true },
    }))
    const skills = createVikingSkills("http://viking:1933", "k", fetchImpl)
    await skills.save(skill, "search-web")
    expect(calls[1]?.init?.method).toBe("PUT")
    expect(calls[1]?.url).toBe("http://viking:1933/api/v1/skills/search-web")
  })

  test("renames by adding the new skill and deleting the old one", async () => {
    const { calls, fetchImpl } = mockFetch(() => ({
      status: "ok",
      result: { valid: true },
    }))
    const skills = createVikingSkills("http://viking:1933", "k", fetchImpl)
    await skills.save(skill, "old-skill")
    expect(
      calls.map((call) => `${call.init?.method ?? "GET"} ${call.url}`),
    ).toEqual([
      "POST http://viking:1933/api/v1/skills/validate",
      "POST http://viking:1933/api/v1/skills",
      "DELETE http://viking:1933/api/v1/skills/old-skill",
    ])
  })

  test("does not delete the old skill if the new one fails", async () => {
    const { calls, fetchImpl } = mockFetch((url) => {
      if (url.endsWith("/skills")) {
        return Response.json(
          { status: "error", error: { message: "name already exists" } },
          { status: 409 },
        )
      }
      return { status: "ok", result: { valid: true } }
    })
    const skills = createVikingSkills("http://viking:1933", "k", fetchImpl)
    await expect(skills.save(skill, "old-skill")).rejects.toThrow(
      "name already exists",
    )
    expect(calls.some((call) => call.init?.method === "DELETE")).toBe(false)
  })

  test("deletes a skill", async () => {
    const { calls, fetchImpl } = mockFetch(() => ({
      status: "ok",
      result: { name: "search-web" },
    }))
    const skills = createVikingSkills("http://viking:1933", "k", fetchImpl)
    await skills.remove("search-web")
    expect(calls[0]?.init?.method).toBe("DELETE")
    expect(calls[0]?.url).toBe("http://viking:1933/api/v1/skills/search-web")
  })

  test("rejects reserved and empty skills locally", () => {
    expect(() => assertSkillInput({ ...skill, name: "desktop" })).toThrow(
      HttpError,
    )
    expect(() => assertSkillInput({ ...skill, name: "shortcut" })).toThrow(
      "shortcut is a built-in skill",
    )
    expect(() => assertSkillInput({ ...skill, name: "refine" })).toThrow(
      "refine is a built-in skill",
    )
    expect(() =>
      assertSkillInput({ ...skill, name: "shortcut-open-mail" }),
    ).not.toThrow()
    expect(() => assertSkillInput({ ...skill, description: "" })).toThrow(
      "description is required",
    )
    expect(() => assertSkillInput({ ...skill, body: "  " })).toThrow(
      "skill body is required",
    )
  })
})
