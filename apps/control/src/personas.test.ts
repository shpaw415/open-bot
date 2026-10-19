import { describe, expect, mock, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { emptyAppliedLog, openDatabase } from "@open-bot/db"

// The catalog route and the mcp config read probe the desktop through
// docker; keep every test in this file off the real docker binary.
let fakeExec: { code: number; stdout: string } | null = null
mock.module("./docker", () => ({
  endpoint: async () => "http://viking:1933",
  isRunning: async () => false,
  opencodeExec: () => {
    if (fakeExec) return fakeExec
    throw new Error("not mocked")
  },
  restartOpencode: async () => {},
}))

const {
  ASSISTANT_ID,
  findPersona,
  handlePersonas,
  listPersonas,
  mcpDenyRules,
  mergeSystem,
  nameSimilarity,
  parseMcpList,
  parsePersonaInput,
  parseSkillList,
  personaScope,
  personaSystem,
  resolvePersona,
  skillRuleset,
} = await import("./personas")

function open() {
  return openDatabase(join(mkdtempSync(join(tmpdir(), "ob-")), "bot.sqlite"))
}

function addCustom(
  db: ReturnType<typeof openDatabase>,
  id: string,
  name: string,
  skills: string[] | null = null,
  skillsExtra: string[] | null = null,
  mcp: string[] | null = null,
  mcpExtra: string[] | null = null,
) {
  db.createPersona({
    id,
    userId: "u",
    name,
    instruction: "run the team",
    skills,
    skillsExtra,
    mcp,
    mcpExtra,
    createdAt: Date.now(),
  })
}

describe("findPersona", () => {
  test("matches a name case-insensitively and an id exactly", () => {
    const db = open()
    addCustom(db, "p1", "Software manager")
    expect(findPersona(db, "u", "software MANAGER")).toEqual({
      persona: expect.objectContaining({ id: "p1" }),
      matched: "exact",
    })
    expect(findPersona(db, "u", "assistant")).toEqual({
      persona: expect.objectContaining({ id: ASSISTANT_ID }),
      matched: "exact",
    })
  })

  test("rescues typos when one candidate is clearly closest", () => {
    const db = open()
    addCustom(db, "p1", "Software manager")
    const fuzzy = findPersona(db, "u", "softwre managr")
    if (!fuzzy.persona) throw new Error("expected a fuzzy match")
    expect(fuzzy.matched).toBe("fuzzy")
    expect(fuzzy.persona.id).toBe("p1")
    const swapped = findPersona(db, "u", "softwaer manager")
    if (!swapped.persona) throw new Error("expected a fuzzy match")
    expect(swapped.matched).toBe("fuzzy")
  })

  test("matches a short custom name exactly", () => {
    const db = open()
    addCustom(db, "p1", "Ops")
    expect(findPersona(db, "u", "ops")).toEqual({
      persona: expect.objectContaining({ id: "p1" }),
      matched: "exact",
    })
  })

  test("refuses a near-tie between two candidates and suggests instead", () => {
    const db = open()
    addCustom(db, "p1", "Software manager")
    addCustom(db, "p2", "Softwarex manager")
    const match = findPersona(db, "u", "softwarey manager")
    expect(match.persona).toBeNull()
    if (!match.persona)
      expect(match.suggestions).toEqual(
        expect.arrayContaining(["Software manager", "Softwarex manager"]),
      )
  })

  test("unknown names return the closest suggestions", () => {
    const db = open()
    addCustom(db, "p1", "Software manager")
    addCustom(db, "p2", "Chef")
    const match = findPersona(db, "u", "zzzzzz")
    expect(match.persona).toBeNull()
    if (!match.persona) expect(match.suggestions).toHaveLength(3)
  })

  test("personas of other users are invisible", () => {
    const db = open()
    db.createPersona({
      id: "p9",
      userId: "someone-else",
      name: "Software manager",
      instruction: "x",
      skills: null,
      skillsExtra: null,
      mcp: null,
      mcpExtra: null,
      createdAt: Date.now(),
    })
    const match = findPersona(db, "u", "Software manager")
    expect(match.persona).toBeNull()
  })
})

describe("persona skill scopes", () => {
  test("listPersonas carries base, extras, and the pre-merged effective list", () => {
    const db = open()
    addCustom(db, "p1", "Chef", ["research", "media"], ["preview"])
    addCustom(db, "p2", "Baker", null, null)
    const chef = listPersonas(db, "u").find((row) => row.id === "p1")
    const baker = listPersonas(db, "u").find((row) => row.id === "p2")
    expect(chef?.skills).toEqual(["research", "media"])
    expect(chef?.skillsExtra).toEqual(["preview"])
    expect(chef?.skillsEffective).toEqual(["research", "media", "preview"])
    expect(baker?.skillsEffective).toBeNull()
  })

  test("parseSkillList rejects glob characters, non-strings, and oversized lists", () => {
    expect(parseSkillList([" research ", "research", "media"])).toEqual({
      skills: ["research", "media"],
    })
    expect(parseSkillList([])).toEqual({ skills: null })
    expect(parseSkillList(null)).toEqual({ skills: null })
    const rejects = (input: unknown) =>
      expect(parseSkillList(input)).toEqual({ error: expect.any(String) })
    rejects("*")
    rejects(["weather*"])
    rejects(["a[b]"])
    rejects([42])
    rejects("weather")
    rejects(Array.from({ length: 65 }, (_, i) => `s-${i}`))
  })

  test("skillRuleset puts one deny-all first and one allow per skill after", () => {
    const db = open()
    addCustom(db, "p1", "Chef", ["research", "media"])
    const persona = resolvePersona(db, "u", "p1")
    expect(skillRuleset(persona)).toEqual([
      { permission: "skill", pattern: "*", action: "deny" },
      { permission: "skill", pattern: "research", action: "allow" },
      { permission: "skill", pattern: "media", action: "allow" },
    ])
    expect(skillRuleset(resolvePersona(db, "u", "p2"))).toBeNull()
    expect(skillRuleset(null)).toBeNull()
  })

  test("parseMcpList accepts server names and rejects globs and oversized lists", () => {
    expect(parseMcpList([" Stock.Data ", "stock", "files"])).toEqual({
      mcp: ["Stock.Data", "stock", "files"],
    })
    // an explicitly empty list is the block-all state
    expect(parseMcpList([])).toEqual({ mcp: [] })
    expect(parseMcpList(null)).toEqual({ mcp: null })
    const rejects = (input: unknown) =>
      expect(parseMcpList(input)).toEqual({ error: expect.any(String) })
    rejects("*")
    rejects(["stock*"])
    rejects(["a[b]"])
    rejects([42])
    rejects("stock")
    rejects(Array.from({ length: 17 }, (_, i) => `srv-${i}`))
  })

  test("listPersonas merges mcp base and extras like skills", () => {
    const db = open()
    addCustom(db, "p1", "Trader", ["research"], null, ["stock"], ["weather"])
    const trader = listPersonas(db, "u").find((row) => row.id === "p1")
    expect(trader?.mcp).toEqual(["stock"])
    expect(trader?.mcpExtra).toEqual(["weather"])
    expect(trader?.mcpEffective).toEqual(["stock", "weather"])
  })

  test("mcpDenyRules enumerates one <server>_* deny per unlisted server", () => {
    expect(mcpDenyRules(["stock"], ["stock", "files", "context7"])).toEqual([
      { permission: "files_*", pattern: "*", action: "deny" },
      { permission: "context7_*", pattern: "*", action: "deny" },
    ])
    // an empty allowlist denies every configured server (block-all)
    expect(mcpDenyRules([], ["stock", "files"])).toEqual([
      { permission: "stock_*", pattern: "*", action: "deny" },
      { permission: "files_*", pattern: "*", action: "deny" },
    ])
    expect(mcpDenyRules(["stock", "files"], ["stock", "files"])).toEqual([])
  })

  test("mcp block-all: effective stays empty and the scope denies everything", async () => {
    const db = open()
    addCustom(db, "p1", "Airgapped", null, null, [])
    const persona = resolvePersona(db, "u", "p1")
    expect(persona?.mcp).toEqual([])
    expect(persona?.mcpEffective).toEqual([])
    fakeExec = { code: 0, stdout: JSON.stringify({ stock: {}, files: {} }) }
    await expect(personaScope("u", persona)).resolves.toEqual([
      { permission: "stock_*", pattern: "*", action: "deny" },
      { permission: "files_*", pattern: "*", action: "deny" },
    ])
    // extras cannot resurrect a blocked-everything base
    db.updatePersona("p1", "u", { mcpExtra: ["stock"] })
    fakeExec = { code: 0, stdout: JSON.stringify({ stock: {} }) }
    await expect(
      personaScope("u", resolvePersona(db, "u", "p1")),
    ).resolves.toEqual([
      { permission: "stock_*", pattern: "*", action: "deny" },
    ])
    // block-all with zero configured servers needs no rules
    fakeExec = { code: 0, stdout: JSON.stringify({}) }
    await expect(
      personaScope("u", resolvePersona(db, "u", "p1")),
    ).resolves.toBeNull()
    fakeExec = null
  })

  test("personaScope combines skill rules with mcp denies and degrades", async () => {
    const db = open()
    addCustom(db, "p1", "Trader", ["research"], null, ["stock"])
    const persona = resolvePersona(db, "u", "p1")
    fakeExec = {
      code: 0,
      stdout: JSON.stringify({ stock: {}, files: {}, context7: {} }),
    }
    await expect(personaScope("u", persona)).resolves.toEqual([
      { permission: "skill", pattern: "*", action: "deny" },
      { permission: "skill", pattern: "research", action: "allow" },
      { permission: "files_*", pattern: "*", action: "deny" },
      { permission: "context7_*", pattern: "*", action: "deny" },
    ])
    // the mcp config read failing degrades to the skills-only ruleset
    fakeExec = null
    await expect(personaScope("u", persona)).resolves.toEqual([
      { permission: "skill", pattern: "*", action: "deny" },
      { permission: "skill", pattern: "research", action: "allow" },
    ])
    // mcp-only restriction: just the denies
    addCustom(db, "p2", "Broker", null, null, ["stock"])
    fakeExec = { code: 0, stdout: JSON.stringify({ stock: {}, files: {} }) }
    await expect(
      personaScope("u", resolvePersona(db, "u", "p2")),
    ).resolves.toEqual([
      { permission: "files_*", pattern: "*", action: "deny" },
    ])
    // unrestricted personas produce no ruleset
    addCustom(db, "p3", "Baker")
    await expect(
      personaScope("u", resolvePersona(db, "u", "p3")),
    ).resolves.toBeNull()
    fakeExec = null
  })

  test("personaSystem appends the restricted clauses only when scoped", () => {
    const db = open()
    addCustom(db, "p1", "Chef", ["research", "media"])
    addCustom(db, "p2", "Baker")
    addCustom(db, "p3", "Broker", null, null, ["stock"])
    const scoped = personaSystem(resolvePersona(db, "u", "p1"))
    expect(scoped).toContain("answer as Chef")
    expect(scoped).toContain(
      "Only these skills load in this thread: research, media.",
    )
    expect(scoped).toContain("this personality does not include it")
    expect(scoped).not.toContain("MCP servers")
    expect(personaSystem(resolvePersona(db, "u", "p2"))).not.toContain(
      "Only these skills",
    )
    const broker = personaSystem(resolvePersona(db, "u", "p3"))
    expect(broker).toContain(
      "Only these MCP servers load in this thread: stock.",
    )
    expect(broker).not.toContain("Only these skills")
    addCustom(db, "p4", "Airgapped", null, null, [])
    const airgapped = personaSystem(resolvePersona(db, "u", "p4"))
    expect(airgapped).toContain("No MCP server loads in this thread.")
  })

  test("handlePersonas PUT: base refused on plugin personas, extras accepted", async () => {
    const db = open()
    db.createUser({
      id: "u",
      email: "u@localhost",
      passwordHash: "hash",
      role: "user",
      createdAt: 1,
      mustChangePassword: false,
      disabled: false,
    })
    db.createInstalledPlugin({
      id: "row-1",
      userId: "u",
      pluginId: "weather-pro",
      version: "1.0.0",
      manifest: JSON.stringify({ id: "weather-pro", name: "Weather Pro" }),
      readme: null,
      enabled: true,
      source: "marketplace",
      localPath: null,
      applied: "{}",
      createdAt: 1,
      updatedAt: 1,
    })
    addCustom(db, "p-plugin", "Meteorologist", ["weather"], null, ["stock"])
    addCustom(db, "p-user", "Team lead")
    db.setInstalledPluginApplied("u", "weather-pro", {
      ...emptyAppliedLog(),
      personaIds: ["p-plugin"],
    })
    const put = (id: string, body: unknown) =>
      handlePersonas(
        new Request(`http://control/api/personas/${id}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        new URL(`http://control/api/personas/${id}`),
        db,
        { id: "u" } as never,
      ) as Promise<Response>

    const base = await put("p-plugin", { skills: ["research"] })
    expect(base.status).toBe(409)
    expect(((await base.json()) as { error: string }).error).toMatch(
      /managed by Weather Pro/,
    )
    const extras = await put("p-plugin", {
      skillsExtra: ["research", "media"],
    })
    expect(extras.status).toBe(200)
    expect(
      ((await extras.json()) as { skillsEffective: string[] }).skillsEffective,
    ).toEqual(["weather", "research", "media"])
    // user personas own their base list
    const userBase = await put("p-user", { skills: ["research"] })
    expect(userBase.status).toBe(200)
    expect(
      ((await userBase.json()) as { skillsEffective: string[] })
        .skillsEffective,
    ).toEqual(["research"])
    // omitted fields keep, null clears, invalid rejects
    const cleared = await put("p-user", { skills: null })
    expect(
      ((await cleared.json()) as { skillsEffective: null }).skillsEffective,
    ).toBeNull()
    const bad = await put("p-user", { skills: ["*"] })
    expect(bad.status).toBe(400)
    // mcp mirrors skills: plugin base refused, extras accepted, user base editable
    const mcpBase = await put("p-plugin", { mcp: ["stock"] })
    expect(mcpBase.status).toBe(409)
    expect(((await mcpBase.json()) as { error: string }).error).toMatch(
      /MCP servers are managed by Weather Pro/,
    )
    const mcpExtras = await put("p-plugin", { mcpExtra: ["stock", "files"] })
    expect(mcpExtras.status).toBe(200)
    expect(
      ((await mcpExtras.json()) as { mcpEffective: string[] }).mcpEffective,
    ).toEqual(["stock", "files"])
    const mcpUserBase = await put("p-user", { mcp: ["files"] })
    expect(mcpUserBase.status).toBe(200)
    expect(
      ((await mcpUserBase.json()) as { mcpEffective: string[] }).mcpEffective,
    ).toEqual(["files"])
    const mcpBad = await put("p-user", { mcp: ["sto*"] })
    expect(mcpBad.status).toBe(400)
  })

  test("the skill-catalog route answers before the id regex", async () => {
    const db = open()
    const res = await handlePersonas(
      new Request("http://control/api/personas/skill-catalog"),
      new URL("http://control/api/personas/skill-catalog"),
      db,
      { id: "u" } as never,
    )
    expect(res).not.toBeNull()
    const body = (await (res as Response).json()) as {
      skills: unknown[]
      mcp: unknown[]
      live: boolean
    }
    expect(body).toEqual({ skills: [], mcp: [], live: false })
  })
})

describe("nameSimilarity", () => {
  test("is 1 for identical strings and counts transpositions as one edit", () => {
    expect(nameSimilarity("software manager", "software manager")).toBe(1)
    expect(nameSimilarity("", "")).toBe(1)
    expect(nameSimilarity("softwaer", "software")).toBeCloseTo(1 - 1 / 8)
  })
})

describe("listPersonas", () => {
  test("badges personas a plugin installed and leaves user customs alone", () => {
    const db = open()
    db.createUser({
      id: "u",
      email: "u@localhost",
      passwordHash: "hash",
      role: "user",
      createdAt: 1,
      mustChangePassword: false,
      disabled: false,
    })
    db.createInstalledPlugin({
      id: "row-1",
      userId: "u",
      pluginId: "weather-pro",
      version: "1.0.0",
      manifest: JSON.stringify({ id: "weather-pro", name: "Weather Pro" }),
      readme: null,
      enabled: true,
      source: "marketplace",
      localPath: null,
      applied: "{}",
      createdAt: 1,
      updatedAt: 1,
    })
    addCustom(db, "p-user", "Team lead")
    addCustom(db, "p-plugin", "Meteorologist")
    db.setInstalledPluginApplied("u", "weather-pro", {
      ...emptyAppliedLog(),
      personaIds: ["p-plugin"],
    })
    const personas = listPersonas(db, "u")
    const pluginPersona = personas.find((item) => item.id === "p-plugin")
    const userPersona = personas.find((item) => item.id === "p-user")
    expect(pluginPersona?.plugin).toEqual({
      id: "weather-pro",
      name: "Weather Pro",
    })
    expect(userPersona?.plugin).toBeUndefined()
    expect(
      personas.find((item) => item.id === ASSISTANT_ID)?.plugin,
    ).toBeUndefined()
  })
})

describe("persona system line", () => {
  test("assistant adds nothing", () => {
    const db = openDatabase(
      join(mkdtempSync(join(tmpdir(), "ob-")), "bot.sqlite"),
    )
    expect(personaSystem(resolvePersona(db, "u", ASSISTANT_ID))).toBeNull()
  })

  test("a built-in voice is injected and does not replace rules", () => {
    const db = openDatabase(
      join(mkdtempSync(join(tmpdir(), "ob-")), "bot.sqlite"),
    )
    const line = personaSystem(resolvePersona(db, "u", "designer"))
    expect(line).toContain("answer as Designer")
    expect(line).toContain("does not replace desktop, memory, or safety rules")
  })

  test("unknown id does not inject", () => {
    const db = openDatabase(
      join(mkdtempSync(join(tmpdir(), "ob-")), "bot.sqlite"),
    )
    expect(personaSystem(resolvePersona(db, "u", "missing"))).toBeNull()
  })

  test("merge keeps an existing system string", () => {
    expect(mergeSystem("keep", "voice")).toBe("keep\n\nvoice")
    expect(mergeSystem("  ", "voice")).toBe("voice")
  })

  test("rejects reserved and empty names", () => {
    expect(parsePersonaInput("Designer", "be visual")).toEqual({
      error: "that name is reserved",
    })
    expect(parsePersonaInput("  ", "be visual")).toEqual({
      error: "name must be 1–48 characters",
    })
    expect(parsePersonaInput("Chef", "cook simply")).toEqual({
      name: "Chef",
      instruction: "cook simply",
    })
    expect(parsePersonaInput("Chef", "")).toEqual({
      error: "instruction must be 1–2000 characters",
    })
    expect(parsePersonaInput("Chef", "x".repeat(2001))).toEqual({
      error: "instruction must be 1–2000 characters (got 2001, 1 over)",
    })
  })
})
