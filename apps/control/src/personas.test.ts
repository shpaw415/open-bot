import { describe, expect, mock, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { emptyAppliedLog, openDatabase } from "@open-bot/db"

// The catalog route and the mcp config read probe the desktop through
// docker; keep every test in this file off the real docker binary. Both
// probes ride opencodeExec, so the fake dispatches on the command shape.
let fakeExec: {
  code: number
  stdout: string
  seeds?: { code: number; stdout: string }
  mcp?: { code: number; stdout: string }
} | null = null
mock.module("./docker", () => ({
  endpoint: async () => "http://viking:1933",
  isRunning: async () => false,
  opencodeExec: (_userId: string, argv: string[]) => {
    if (!fakeExec) throw new Error("not mocked")
    const command = argv.join(" ")
    if (command.includes("SKILL.md")) return fakeExec.seeds ?? fakeExec
    if (command.includes("jq")) return fakeExec.mcp ?? fakeExec
    return fakeExec
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
  skillsNone = false,
  mcpNone = false,
) {
  db.createPersona({
    id,
    userId: "u",
    name,
    instruction: "run the team",
    skills,
    skillsExtra,
    skillsNone,
    mcp,
    mcpExtra,
    mcpNone,
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
      skillsNone: false,
      mcp: null,
      mcpExtra: null,
      mcpNone: false,
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
    await expect(personaScope(db, "u", persona)).resolves.toEqual([
      { permission: "stock_*", pattern: "*", action: "deny" },
      { permission: "files_*", pattern: "*", action: "deny" },
    ])
    // extras cannot resurrect a blocked-everything base
    db.updatePersona("p1", "u", { mcpExtra: ["stock"] })
    fakeExec = { code: 0, stdout: JSON.stringify({ stock: {} }) }
    await expect(
      personaScope(db, "u", resolvePersona(db, "u", "p1")),
    ).resolves.toEqual([
      { permission: "stock_*", pattern: "*", action: "deny" },
    ])
    // block-all with zero configured servers needs no rules
    fakeExec = { code: 0, stdout: JSON.stringify({}) }
    await expect(
      personaScope(db, "u", resolvePersona(db, "u", "p1")),
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
    await expect(personaScope(db, "u", persona)).resolves.toEqual([
      { permission: "skill", pattern: "*", action: "deny" },
      { permission: "skill", pattern: "research", action: "allow" },
      { permission: "files_*", pattern: "*", action: "deny" },
      { permission: "context7_*", pattern: "*", action: "deny" },
    ])
    // the mcp config read failing degrades to the skills-only ruleset
    fakeExec = null
    await expect(personaScope(db, "u", persona)).resolves.toEqual([
      { permission: "skill", pattern: "*", action: "deny" },
      { permission: "skill", pattern: "research", action: "allow" },
    ])
    // mcp-only restriction: just the denies
    addCustom(db, "p2", "Broker", null, null, ["stock"])
    fakeExec = { code: 0, stdout: JSON.stringify({ stock: {}, files: {} }) }
    await expect(
      personaScope(db, "u", resolvePersona(db, "u", "p2")),
    ).resolves.toEqual([
      { permission: "files_*", pattern: "*", action: "deny" },
    ])
    // unrestricted personas produce no ruleset
    addCustom(db, "p3", "Baker")
    await expect(
      personaScope(db, "u", resolvePersona(db, "u", "p3")),
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
      dirs: unknown
      live: boolean
    }
    expect(body).toEqual({
      skills: [],
      mcp: [],
      dirs: { skill: [], mcp: [] },
      live: false,
    })
  })
})

describe("built-in persona scopes", () => {
  function openWithPluginMcp() {
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
      pluginId: "stock-pro",
      version: "1.0.0",
      manifest: JSON.stringify({
        id: "stock-pro",
        name: "Stock Pro",
        opencode: { mcp: { stock: { type: "local", command: ["x"] } } },
      }),
      readme: null,
      enabled: true,
      source: "marketplace",
      localPath: null,
      applied: "{}",
      createdAt: 1,
      updatedAt: 1,
    })
    return db
  }

  test("the base is seed skills plus non-plugin MCP servers, extended by extras", async () => {
    const db = openWithPluginMcp()
    db.setBuiltinPersonaScope("u", "plugin-creator", {
      skillsExtra: ["framer-motion"],
      mcpExtra: ["context7"],
    })
    fakeExec = {
      code: 0,
      stdout: JSON.stringify({ stock: {}, files: {} }),
      seeds: { code: 0, stdout: "research\tResearch\nmedia\tMedia\n" },
    }
    const persona = resolvePersona(db, "u", "plugin-creator")
    expect(persona?.skillsExtra).toEqual(["framer-motion"])
    expect(persona?.mcpExtra).toEqual(["context7"])
    // seed skills + extras are allowed; the plugin-owned `stock` server is
    // denied while the unowned `files` server and the `context7` extra stay.
    await expect(personaScope(db, "u", persona)).resolves.toEqual([
      { permission: "skill", pattern: "*", action: "deny" },
      { permission: "skill", pattern: "research", action: "allow" },
      { permission: "skill", pattern: "media", action: "allow" },
      { permission: "skill", pattern: "framer-motion", action: "allow" },
      { permission: "stock_*", pattern: "*", action: "deny" },
    ])
    fakeExec = null
  })

  test("the Assistant loads every skill; only its MCP scope stays seed-based", async () => {
    const db = openWithPluginMcp()
    db.setBuiltinPersonaScope("u", ASSISTANT_ID, {
      mcpExtra: ["context7"],
    })
    fakeExec = {
      code: 0,
      stdout: JSON.stringify({ stock: {}, files: {} }),
      seeds: { code: 0, stdout: "research\tResearch\nmedia\tMedia\n" },
    }
    const persona = resolvePersona(db, "u", ASSISTANT_ID)
    // No skill rules at all — plugin and custom skills load alongside the
    // seed set — while the plugin-owned `stock` MCP server stays denied.
    await expect(personaScope(db, "u", persona)).resolves.toEqual([
      { permission: "stock_*", pattern: "*", action: "deny" },
    ])
    // An explicit block-all still wins over the all-skills base.
    db.setBuiltinPersonaScope("u", ASSISTANT_ID, { skillsNone: true })
    await expect(
      personaScope(db, "u", resolvePersona(db, "u", ASSISTANT_ID)),
    ).resolves.toEqual([
      { permission: "skill", pattern: "*", action: "deny" },
      { permission: "stock_*", pattern: "*", action: "deny" },
    ])
    fakeExec = null
  })

  test("a failed probe degrades to unrestricted instead of blocking", async () => {
    const db = openWithPluginMcp()
    fakeExec = null
    await expect(
      personaScope(db, "u", resolvePersona(db, "u", "plugin-creator")),
    ).resolves.toBeNull()
  })

  test("PUT accepts extras and refuses base, name, and instruction edits", async () => {
    const db = openWithPluginMcp()
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

    const extras = await put("plugin-creator", {
      skillsExtra: ["research", "media"],
      mcpExtra: ["context7"],
    })
    expect(extras.status).toBe(200)
    const saved = (await extras.json()) as {
      skillsExtra: string[] | null
      mcpExtra: string[] | null
      skillsEffective: string[] | null
    }
    expect(saved.skillsExtra).toEqual(["research", "media"])
    expect(saved.mcpExtra).toEqual(["context7"])
    // the locked base is not enumerable synchronously
    expect(saved.skillsEffective).toBeNull()

    const renamed = await put("plugin-creator", { name: "Artist" })
    expect(renamed.status).toBe(400)
    const reinstructed = await put("plugin-creator", { instruction: "x" })
    expect(reinstructed.status).toBe(400)
    const baseSkills = await put("plugin-creator", { skills: ["research"] })
    expect(baseSkills.status).toBe(409)
    const baseMcp = await put("plugin-creator", { mcp: ["files"] })
    expect(baseMcp.status).toBe(409)
    const empty = await put("plugin-creator", {})
    expect(empty.status).toBe(400)

    // present-set / omitted-keep like plugin personas
    const kept = await put("plugin-creator", { skillsExtra: ["research"] })
    expect(kept.status).toBe(200)
    expect(
      ((await kept.json()) as { mcpExtra: string[] | null }).mcpExtra,
    ).toEqual(["context7"])
    const cleared = await put("plugin-creator", { skillsExtra: null })
    expect(
      ((await cleared.json()) as { skillsExtra: string[] | null }).skillsExtra,
    ).toBeNull()

    // The Assistant already loads every skill: a non-empty skillsExtra is
    // refused, a clear is fine, and MCP extras still extend its seed base.
    const assistantExtra = await put(ASSISTANT_ID, {
      skillsExtra: ["research"],
    })
    expect(assistantExtra.status).toBe(409)
    const assistantCleared = await put(ASSISTANT_ID, { skillsExtra: null })
    expect(assistantCleared.status).toBe(200)
    const assistantMcp = await put(ASSISTANT_ID, { mcpExtra: ["context7"] })
    expect(assistantMcp.status).toBe(200)
    expect(
      ((await assistantMcp.json()) as { mcpExtra: string[] | null }).mcpExtra,
    ).toEqual(["context7"])
  })
})

describe("persona block-all", () => {
  test("block-all flags disable every skill and server on any persona kind", async () => {
    const db = open()
    // custom persona: flags alone block everything, even with no lists
    addCustom(db, "p1", "Airgapped", null, null, null, null, true, true)
    const persona = resolvePersona(db, "u", "p1")
    expect(persona?.skillsEffective).toEqual([])
    expect(persona?.mcpEffective).toEqual([])
    // the skill deny-all is a lone catch-all: the whole skill tool goes away
    expect(skillRuleset(persona)).toEqual([
      { permission: "skill", pattern: "*", action: "deny" },
    ])
    fakeExec = { code: 0, stdout: JSON.stringify({ stock: {}, files: {} }) }
    await expect(personaScope(db, "u", persona)).resolves.toEqual([
      { permission: "skill", pattern: "*", action: "deny" },
      { permission: "stock_*", pattern: "*", action: "deny" },
      { permission: "files_*", pattern: "*", action: "deny" },
    ])
    // an explicit base list replaces the block-all (the API clears the flag
    // when a list arrives; direct db writes clear it explicitly)
    db.updatePersona("p1", "u", {
      skills: ["research"],
      mcp: ["stock"],
      skillsNone: false,
      mcpNone: false,
    })
    const listed = resolvePersona(db, "u", "p1")
    expect(listed?.skillsEffective).toEqual(["research"])
    expect(listed?.mcpEffective).toEqual(["stock"])
    fakeExec = null
    // the line names the blocked state instead of enumerating
    addCustom(db, "p2", "Muted", null, null, null, null, true, false)
    const line = personaSystem(resolvePersona(db, "u", "p2"))
    expect(line).toContain("No skills load in this thread")
    expect(line).not.toContain("No MCP server")
  })

  test("built-in block-all skips the probes and blocks outright", async () => {
    const db = open()
    fakeExec = null
    db.createUser({
      id: "u",
      email: "u@localhost",
      passwordHash: "hash",
      role: "user",
      createdAt: 1,
      mustChangePassword: false,
      disabled: false,
    })
    db.setBuiltinPersonaScope("u", "plugin-creator", {
      skillsNone: true,
      mcpNone: true,
    })
    // no fakeExec: the flags must short-circuit the seed probe — the skill
    // deny-all applies even when the desktop cannot answer; the MCP half
    // degrades (config unreadable → skills-only rules)
    const persona = resolvePersona(db, "u", "plugin-creator")
    expect(persona?.skillsNone).toBe(true)
    expect(persona?.mcpNone).toBe(true)
    await expect(personaScope(db, "u", persona)).resolves.toEqual([
      { permission: "skill", pattern: "*", action: "deny" },
    ])
    // with the config readable, every configured server is denied too
    fakeExec = { code: 0, stdout: JSON.stringify({ stock: {}, files: {} }) }
    await expect(personaScope(db, "u", persona)).resolves.toEqual([
      { permission: "skill", pattern: "*", action: "deny" },
      { permission: "stock_*", pattern: "*", action: "deny" },
      { permission: "files_*", pattern: "*", action: "deny" },
    ])
    fakeExec = null
    const line = personaSystem(persona)
    expect(line).toContain("No skills load in this thread")
    expect(line).toContain("No MCP server loads in this thread")
  })

  test("PUT accepts the block-all flags on custom, plugin, and built-in personas", async () => {
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
    addCustom(db, "p-plugin", "Meteorologist", ["weather"])
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

    const userBlocked = await put("p-user", { skillsNone: true })
    expect(userBlocked.status).toBe(200)
    expect(
      ((await userBlocked.json()) as { skillsEffective: string[] | null })
        .skillsEffective,
    ).toEqual([])
    // a non-boolean flag is rejected
    const bad = await put("p-user", { skillsNone: "yes" })
    expect(bad.status).toBe(400)
    // plugin persona: the user may block the plugin's surfaces outright
    const pluginBlocked = await put("p-plugin", { mcpNone: true })
    expect(pluginBlocked.status).toBe(200)
    expect(
      ((await pluginBlocked.json()) as { mcpEffective: string[] | null })
        .mcpEffective,
    ).toEqual([])
    // a base list replaces the block-all
    const listed = await put("p-user", { skills: ["research"] })
    const listedBody = (await listed.json()) as {
      skillsEffective: string[] | null
      skillsNone: boolean
    }
    expect(listedBody.skillsEffective).toEqual(["research"])
    expect(listedBody.skillsNone).toBe(false)
    // built-in: block + unblock through the scope row
    const builtinBlocked = await put("plugin-creator", { skillsNone: true })
    expect(builtinBlocked.status).toBe(200)
    expect(
      ((await builtinBlocked.json()) as { skillsNone: boolean }).skillsNone,
    ).toBe(true)
    const builtinFreed = await put("plugin-creator", { skillsNone: false })
    expect(
      ((await builtinFreed.json()) as { skillsNone: boolean }).skillsNone,
    ).toBe(false)
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

describe("built-in roster", () => {
  test("ships exactly Assistant and Open-bot Plugin Creator", () => {
    const db = open()
    const builtins = listPersonas(db, "u").filter((item) => item.builtin)
    expect(builtins.map((item) => item.id)).toEqual([
      "assistant",
      "plugin-creator",
    ])
    expect(builtins[1]?.name).toBe("Open-bot Plugin Creator")
    // the creator instruction is a lean per-prompt line — the detailed
    // conventions live in the plugin-creator seed skill it points at
    expect(builtins[1]?.instruction).toContain("smallest shape")
    expect(builtins[1]?.instruction).toContain("plugin-creator skill")
    expect(builtins[1]?.instruction).toContain("never as repeated agent steps")
    expect(builtins[1]?.instruction).toContain("script-first")
    expect((builtins[1]?.instruction ?? "").length).toBeLessThan(2000)
  })

  test("removed built-ins no longer resolve", () => {
    const db = open()
    for (const id of ["designer", "political-expert", "software-designer"])
      expect(resolvePersona(db, "u", id)).toBeNull()
    expect(findPersona(db, "u", "open-bot plugin creator").persona?.id).toBe(
      "plugin-creator",
    )
  })
})

describe("persona system line", () => {
  test("assistant injects only the scope clauses: all skills, built-in MCP", () => {
    const db = openDatabase(
      join(mkdtempSync(join(tmpdir(), "ob-")), "bot.sqlite"),
    )
    const line = personaSystem(resolvePersona(db, "u", ASSISTANT_ID))
    expect(line).toContain("All skills load in this thread")
    expect(line).toContain("plugin and custom skills")
    expect(line).not.toContain("Only the desktop's built-in skills")
    expect(line).toContain("built-in MCP servers")
    expect(line).not.toContain("answer as")
    expect(line).not.toContain("does not replace desktop, memory, or safety")
  })

  test("a built-in voice is injected, lists its additions, and does not replace rules", () => {
    const db = openDatabase(
      join(mkdtempSync(join(tmpdir(), "ob-")), "bot.sqlite"),
    )
    db.setBuiltinPersonaScope("u", "plugin-creator", {
      skillsExtra: ["framer-motion"],
    })
    const line = personaSystem(resolvePersona(db, "u", "plugin-creator"))
    expect(line).toContain("answer as Open-bot Plugin Creator")
    expect(line).toContain("does not replace desktop, memory, or safety rules")
    expect(line).toContain("built-in skills plus these added ones")
    expect(line).toContain("framer-motion")
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
    expect(parsePersonaInput("Open-bot Plugin Creator", "build")).toEqual({
      error: "that name is reserved",
    })
    // a removed built-in's name is free for custom personas again
    expect(parsePersonaInput("Designer", "be visual")).toEqual({
      name: "Designer",
      instruction: "be visual",
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
