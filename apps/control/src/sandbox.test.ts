import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openDatabase } from "@open-bot/db"
import type { PersonaView } from "./personas"
import {
  builtinSandboxProfile,
  CODE_SANDBOX_PROFILE,
  LOCKED_SANDBOX_PROFILE,
  narrowProfileWithPersona,
  parseSandboxCopyIn,
  parseSandboxProfile,
  resolveSandboxMcp,
  resolveSandboxProfileRef,
  sandboxAgentsMd,
  sandboxOpencodeConfig,
  sandboxRunArgs,
  sandboxScopeRules,
} from "./sandbox"

const configFor = (
  profile = LOCKED_SANDBOX_PROFILE,
  mcp: Record<string, never> = {},
) =>
  sandboxOpencodeConfig(profile, {
    brokerBase: "http://open-bot:8787/llm/v1",
    brokerToken: "broker-token-123",
    mcp,
  })

describe("sandbox profile validation", () => {
  test("defaults are locked down", () => {
    const parsed = parseSandboxProfile({ name: "x" })
    expect("profile" in parsed).toBe(true)
    if (!("profile" in parsed)) return
    expect(parsed.profile.network).toBe("off")
    expect(parsed.profile.tools.bash).toBe(false)
    expect(parsed.profile.tools.webfetch).toBe(false)
    expect(parsed.profile.tools.task).toBe(false)
    expect(parsed.profile.skills).toEqual([])
    expect(parsed.profile.mcp).toEqual([])
  })

  test("rejects globs, unknown fields, and bad tools", () => {
    expect(parseSandboxProfile({ name: "x", skills: ["*"] })).toHaveProperty(
      "error",
    )
    expect(parseSandboxProfile({ name: "x", mcp: ["a*"] })).toHaveProperty(
      "error",
    )
    expect(parseSandboxProfile({ name: "x", sudo: true })).toHaveProperty(
      "error",
    )
    expect(
      parseSandboxProfile({ name: "x", tools: { teleport: true } }),
    ).toHaveProperty("error")
    expect(parseSandboxProfile({ name: "x", network: "lan" })).toHaveProperty(
      "error",
    )
    expect(
      parseSandboxProfile({ name: "x", limits: { memoryMb: 99999 } }),
    ).toHaveProperty("error")
  })

  test("copyIn refuses protected paths", () => {
    expect(
      parseSandboxCopyIn(["/home/agent/workspace/notes.md"]),
    ).toHaveProperty("paths")
    expect(parseSandboxCopyIn(["/home/agent/.ssh/id_rsa"])).toHaveProperty(
      "error",
    )
    expect(
      parseSandboxCopyIn(["/home/agent/.local/share/opencode/auth.json"]),
    ).toHaveProperty("error")
    expect(parseSandboxCopyIn(["/etc/passwd"])).toHaveProperty("error")
    expect(
      parseSandboxCopyIn(["/home/agent/workspace/../.ssh"]),
    ).toHaveProperty("error")
  })

  test("a persona can only narrow a profile", () => {
    const profile = {
      ...LOCKED_SANDBOX_PROFILE,
      skills: ["research", "media"],
      mcp: ["stock", "files"],
    }
    const persona = {
      instruction: "be terse",
      skillsEffective: ["research"],
      mcpEffective: ["files", "other"],
    } as PersonaView
    const narrowed = narrowProfileWithPersona(profile, persona)
    expect(narrowed.skills).toEqual(["research"])
    expect(narrowed.mcp).toEqual(["files"])
    expect(narrowed.instruction).toBe("be terse")
  })
})

describe("generated opencode config", () => {
  test("locked profile: no bash, no skill tool, workspace-only writes", () => {
    const config = configFor()
    const agent = config.agent.sandbox
    expect(agent.tools["*"]).toBe(false)
    expect(agent.tools.bash).toBeUndefined()
    expect(agent.tools.skill).toBeUndefined()
    expect(agent.tools.task).toBeUndefined()
    expect(config.permission.bash).toBe("deny")
    expect(config.permission.external_directory).toBe("deny")
    expect(config.permission.edit).toEqual({
      "*": "deny",
      "/workspace/*": "allow",
    })
  })

  test("code profile enables bash inside the jail only", () => {
    const config = configFor(CODE_SANDBOX_PROFILE)
    expect(config.agent.sandbox.tools.bash).toBe(true)
    expect(config.permission.bash).toBe("allow")
  })

  test("only the broker token is secret-shaped; skills unlock the skill tool", () => {
    const profile = { ...LOCKED_SANDBOX_PROFILE, skills: ["research"] }
    const text = JSON.stringify(configFor(profile))
    expect(text).toContain("broker-token-123")
    for (const needle of [
      "OPEN_BOT_LLM_TOKEN",
      "OPENVIKING",
      "GITHUB_TOKEN",
      "auth.json",
      "/home/agent",
      "ob-thread",
      "ob-api-key",
    ])
      expect(text).not.toContain(needle)
    expect(configFor(profile).agent.sandbox.tools.skill).toBe(true)
    expect(sandboxAgentsMd(profile)).toContain("research")
    expect(sandboxAgentsMd(profile)).not.toContain("ob-")
  })

  test("scope rules deny unlisted skills and MCP servers", () => {
    const rules = sandboxScopeRules(
      { ...LOCKED_SANDBOX_PROFILE, skills: ["research"], mcp: ["stock"] },
      ["stock", "secret-server"],
    )
    expect(rules[0]).toEqual({
      permission: "skill",
      pattern: "*",
      action: "deny",
    })
    expect(rules).toContainEqual({
      permission: "skill",
      pattern: "research",
      action: "allow",
    })
    expect(rules).toContainEqual({
      permission: "secret-server_*",
      pattern: "*",
      action: "deny",
    })
  })
})

describe("MCP resolution", () => {
  const configured = {
    stock: {
      type: "remote" as const,
      url: "https://mcp.example/s",
      headers: { authorization: "Bearer k" },
    },
    echo: { type: "local" as const, command: ["bun", "server.ts"] },
    heavy: { type: "local" as const, command: ["/opt/vendor/bin/serve"] },
    plug: {
      type: "local" as const,
      command: ["/usr/local/bin/ob-plugin-x-tool"],
      environment: { API_KEY: "secret" },
    },
  }

  test("remote MCP with network off refuses the launch", () => {
    const out = resolveSandboxMcp(
      { ...LOCKED_SANDBOX_PROFILE, mcp: ["stock"] },
      configured,
    )
    expect(out).toHaveProperty("error")
  })

  test("headers and env are stripped without the secrets opt-in", () => {
    const out = resolveSandboxMcp(
      {
        ...LOCKED_SANDBOX_PROFILE,
        network: "on" as const,
        mcp: ["stock", "plug"],
      },
      configured,
    )
    if (!("mcp" in out)) throw new Error("expected mcp")
    expect(out.mcp.stock?.headers).toBeUndefined()
    expect(out.mcp.plug?.environment?.API_KEY).toBeUndefined()
    expect(out.mcp.plug?.command?.[0]).toBe(
      "/home/sandbox/.local/bin/ob-plugin-x-tool",
    )
    const withSecrets = resolveSandboxMcp(
      {
        ...LOCKED_SANDBOX_PROFILE,
        network: "on" as const,
        mcpSecrets: true,
        mcp: ["stock", "plug"],
      },
      configured,
    )
    if (!("mcp" in withSecrets)) throw new Error("expected mcp")
    expect(withSecrets.mcp.stock?.headers?.authorization).toBe("Bearer k")
    expect(withSecrets.mcp.plug?.environment?.API_KEY).toBe("secret")
  })

  test("unrunnable local servers are skipped with a reason, never silently", () => {
    const out = resolveSandboxMcp(
      { ...LOCKED_SANDBOX_PROFILE, mcp: ["echo", "heavy", "ghost"] },
      configured,
    )
    if (!("mcp" in out)) throw new Error("expected mcp")
    expect(out.included).toEqual(["echo"])
    expect(out.skipped.map((row) => row.name)).toEqual(["heavy", "ghost"])
  })
})

describe("container boundary args", () => {
  test("no caps, no sudo path, no desktop mounts or published ports", () => {
    const args = sandboxRunArgs({
      userId: "user-1",
      id: "abc123",
      profile: CODE_SANDBOX_PROFILE,
      opencodePassword: "pw",
    })
    const joined = args.join(" ")
    expect(joined).toContain("--cap-drop ALL")
    expect(joined).toContain("no-new-privileges")
    expect(joined).toContain("--read-only")
    expect(joined).toContain("--pids-limit 256")
    expect(joined).not.toContain("SYS_ADMIN")
    expect(joined).not.toContain("/home/agent")
    expect(joined).not.toContain("OPEN_BOT_LLM_TOKEN")
    expect(joined).not.toContain("OPENVIKING")
    expect(joined).not.toContain("GITHUB_TOKEN")
    expect(args).not.toContain("-p")
    expect(args).not.toContain("--privileged")
  })
})

describe("profile refs", () => {
  test("built-ins, stored profiles, and unknown names", () => {
    const db = openDatabase(
      join(mkdtempSync(join(tmpdir(), "ob-")), "bot.sqlite"),
    )
    db.createUser({
      id: "a",
      email: "a@localhost",
      passwordHash: "x",
      role: "user",
      createdAt: 1,
      mustChangePassword: false,
      disabled: false,
    })
    expect(resolveSandboxProfileRef(db, "a", "locked")).toMatchObject({
      profile: { name: "locked" },
    })
    expect(builtinSandboxProfile("code")?.tools.bash).toBe(true)
    expect(resolveSandboxProfileRef(db, "a", "nope")).toHaveProperty("error")
    db.saveSandboxProfile({
      id: "sp1",
      userId: "a",
      name: "mine",
      profile: JSON.stringify({ name: "mine", skills: ["research"] }),
      createdAt: 1,
      updatedAt: 1,
    })
    const out = resolveSandboxProfileRef(db, "a", "mine")
    if (!("profile" in out)) throw new Error("expected profile")
    expect(out.profileId).toBe("sp1")
    expect(out.profile.skills).toEqual(["research"])
  })
})
