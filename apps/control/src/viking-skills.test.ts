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

  test("creates a skill without blocking on indexing", async () => {
    const { calls, fetchImpl } = mockFetch((url, init) => {
      const method = init?.method ?? "GET"
      if (url.endsWith("/validate"))
        return { status: "ok", result: { valid: true } }
      if (method === "GET" && url.includes("/api/v1/skills/search-web"))
        return {
          status: "ok",
          result: {
            name: "search-web",
            description: skill.description,
            content: skill.body,
          },
        }
      return { status: "ok", result: {} }
    })
    const skills = createVikingSkills("http://viking:1933/", "k", fetchImpl)
    await skills.save(skill)
    // Deletes first so a retry after a lost response can never 409 on an
    // existing name (the duplicate-creation failure mode from the field).
    expect(calls[1]?.init?.method).toBe("DELETE")
    expect(calls[2]?.init?.method).toBe("POST")
    expect(calls[2]?.url).toBe("http://viking:1933/api/v1/skills")
    expect(JSON.parse(String(calls[2]?.init?.body))).toEqual({
      data: {
        name: "search-web",
        description: skill.description,
        content: skill.body,
      },
      wait: false,
    })
    // The read-back confirm proves the write landed without a sync wait.
    expect(calls[3]?.init?.method ?? "GET").toBe("GET")
  })

  test("updates in place by delete and post instead of the wedging PUT", async () => {
    const { calls, fetchImpl } = mockFetch((url, init) => {
      const method = init?.method ?? "GET"
      if (url.endsWith("/validate"))
        return { status: "ok", result: { valid: true } }
      if (method === "GET" && url.includes("/api/v1/skills/search-web"))
        return {
          status: "ok",
          result: {
            name: "search-web",
            description: skill.description,
            content: skill.body,
          },
        }
      return { status: "ok", result: {} }
    })
    const skills = createVikingSkills("http://viking:1933", "k", fetchImpl)
    await skills.save(skill, "search-web")
    expect(
      calls.map((call) => `${call.init?.method ?? "GET"} ${call.url}`),
    ).toEqual([
      "POST http://viking:1933/api/v1/skills/validate",
      "DELETE http://viking:1933/api/v1/skills/search-web",
      "POST http://viking:1933/api/v1/skills",
      "GET http://viking:1933/api/v1/skills/search-web?include_content=true&include_files=false",
    ])
  })

  test("renames by adding the new skill and deleting the old one", async () => {
    const { calls, fetchImpl } = mockFetch((url, init) => {
      const method = init?.method ?? "GET"
      if (url.endsWith("/validate"))
        return { status: "ok", result: { valid: true } }
      if (method === "GET" && url.includes("/api/v1/skills/search-web"))
        return {
          status: "ok",
          result: {
            name: "search-web",
            description: skill.description,
            content: skill.body,
          },
        }
      return { status: "ok", result: {} }
    })
    const skills = createVikingSkills("http://viking:1933", "k", fetchImpl)
    await skills.save(skill, "old-skill")
    expect(
      calls.map((call) => `${call.init?.method ?? "GET"} ${call.url}`),
    ).toEqual([
      "POST http://viking:1933/api/v1/skills/validate",
      "POST http://viking:1933/api/v1/skills",
      "DELETE http://viking:1933/api/v1/skills/old-skill",
      "GET http://viking:1933/api/v1/skills/search-web?include_content=true&include_files=false",
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

  test("treats a 404 delete as gone and creates the skill anyway", async () => {
    const { calls, fetchImpl } = mockFetch((url, init) => {
      const method = init?.method ?? "GET"
      if (method === "DELETE")
        return Response.json(
          { status: "error", error: { message: "not found" } },
          { status: 404 },
        )
      if (url.endsWith("/validate"))
        return { status: "ok", result: { valid: true } }
      if (method === "GET" && url.includes("/api/v1/skills/search-web"))
        return {
          status: "ok",
          result: { name: "search-web", content: skill.body },
        }
      return { status: "ok", result: {} }
    })
    const skills = createVikingSkills("http://viking:1933", "k", fetchImpl)
    await skills.save(skill)
    expect(calls.some((call) => call.init?.method === "POST" && call.url.endsWith("/skills"))).toBe(true)
  })

  test("update waits out the indexing 409 before posting the replacement", async () => {
    let deletes = 0
    const updated = { ...skill, body: `${skill.body}\n\nUpdated.` }
    const { calls, fetchImpl } = mockFetch((url, init) => {
      const method = init?.method ?? "GET"
      if (url.endsWith("/validate"))
        return { status: "ok", result: { valid: true } }
      if (method === "DELETE") {
        deletes += 1
        if (deletes < 3)
          return Response.json(
            { status: "error", error: { message: "conflict" } },
            { status: 409 },
          )
        return { status: "ok", result: {} }
      }
      if (method === "GET" && url.includes("/api/v1/skills/search-web"))
        return {
          status: "ok",
          result: { name: "search-web", content: updated.body },
        }
      return { status: "ok", result: {} }
    })
    const skills = createVikingSkills("http://viking:1933", "k", fetchImpl, {
      deleteWaitMs: 5_000,
      deletePollDelayMs: 1,
      confirmAttempts: 1,
    })
    await skills.save(updated)
    expect(deletes).toBe(3)
    const deleteIndex = calls.findIndex((call) => call.init?.method === "DELETE")
    const postIndex = calls.findIndex(
      (call) => call.init?.method === "POST" && call.url.endsWith("/skills"),
    )
    expect(postIndex).toBeGreaterThan(deleteIndex)
  })

  test("save fails with a retryable error when the delete 409 never clears", async () => {
    const { calls, fetchImpl } = mockFetch((url, init) => {
      const method = init?.method ?? "GET"
      if (method === "DELETE")
        return Response.json(
          { status: "error", error: { message: "conflict" } },
          { status: 409 },
        )
      if (url.endsWith("/validate"))
        return { status: "ok", result: { valid: true } }
      return { status: "ok", result: {} }
    })
    const skills = createVikingSkills("http://viking:1933", "k", fetchImpl, {
      deleteWaitMs: 20,
      deletePollDelayMs: 1,
    })
    await expect(skills.save(skill)).rejects.toThrow("still being indexed")
    expect(calls.some((call) => call.init?.method === "POST" && call.url.endsWith("/skills"))).toBe(false)
  })

  test("confirm accepts the overview body when content is absent", async () => {
    const { fetchImpl } = mockFetch((url, init) => {
      const method = init?.method ?? "GET"
      if (url.endsWith("/validate"))
        return { status: "ok", result: { valid: true } }
      if (method === "GET" && url.includes("/api/v1/skills/search-web"))
        return {
          status: "ok",
          result: {
            name: "search-web",
            overview: skill.body,
          },
        }
      return { status: "ok", result: {} }
    })
    const skills = createVikingSkills("http://viking:1933", "k", fetchImpl, {
      confirmAttempts: 2,
      confirmPollDelayMs: 1,
    })
    await skills.save(skill)
  })

  test("confirm compares normalized: a newline-terminated body still matches", async () => {
    const { fetchImpl } = mockFetch((url, init) => {
      const method = init?.method ?? "GET"
      if (url.endsWith("/validate"))
        return { status: "ok", result: { valid: true } }
      if (method === "DELETE")
        return Response.json(
          { status: "error", error: { message: "not found" } },
          { status: 404 },
        )
      if (method === "GET" && url.includes("/api/v1/skills/search-web"))
        return {
          status: "ok",
          result: {
            name: "search-web",
            // Frontmatter + the body with its trailing newline; skillBody()
            // hands back the trimmed body.
            content: `---\nname: search-web\ndescription: ${skill.description}\n---\n${skill.body}\n`,
          },
        }
      return { status: "ok", result: {} }
    })
    const skills = createVikingSkills("http://viking:1933", "k", fetchImpl, {
      confirmAttempts: 2,
      confirmPollDelayMs: 1,
    })
    await skills.save({ ...skill, body: `${skill.body}\n` })
  })

  test("confirm still fails when the stored body genuinely differs", async () => {
    const { fetchImpl } = mockFetch((url, init) => {
      const method = init?.method ?? "GET"
      if (url.endsWith("/validate"))
        return { status: "ok", result: { valid: true } }
      if (method === "DELETE")
        return Response.json(
          { status: "error", error: { message: "not found" } },
          { status: 404 },
        )
      if (method === "GET" && url.includes("/api/v1/skills/search-web"))
        return {
          status: "ok",
          result: { name: "search-web", content: "# something else" },
        }
      return { status: "ok", result: {} }
    })
    const skills = createVikingSkills("http://viking:1933", "k", fetchImpl, {
      confirmAttempts: 2,
      confirmPollDelayMs: 1,
    })
    await expect(skills.save(skill)).rejects.toThrow("read-back never matched")
  })

  test("remove retries the indexing 409 instead of leaving the skill behind", async () => {
    let deletes = 0
    const { calls, fetchImpl } = mockFetch((url, init) => {
      const method = init?.method ?? "GET"
      if (method === "DELETE") {
        deletes += 1
        if (deletes < 3)
          return Response.json(
            { status: "error", error: { message: "conflict" } },
            { status: 409 },
          )
        return { status: "ok", result: {} }
      }
      return { status: "ok", result: {} }
    })
    const skills = createVikingSkills("http://viking:1933", "k", fetchImpl, {
      deleteWaitMs: 5_000,
      deletePollDelayMs: 1,
    })
    await skills.remove("search-web")
    expect(deletes).toBe(3)
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
