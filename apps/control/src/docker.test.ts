import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { opencodePatchProgram } from "./docker"

const jq = spawnSync("jq", ["--version"])
const hasJq = jq.status === 0

// The desktop image ships jq 1.6 and the host 1.7; has()/index() behave the
// same for this program on both, so the host binary is a valid stand-in.
function runJq(config: unknown, patch: Record<string, unknown>) {
  const dir = mkdtempSync(join(tmpdir(), "oc-jq-"))
  const file = join(dir, "opencode.json")
  writeFileSync(file, JSON.stringify(config))
  try {
    const result = spawnSync("jq", [
      "--argjson",
      "addP",
      JSON.stringify(patch.addPlugins ?? []),
      "--argjson",
      "rmP",
      JSON.stringify(patch.removePlugins ?? []),
      "--argjson",
      "addM",
      JSON.stringify(patch.addMcp ?? {}),
      "--argjson",
      "rmM",
      JSON.stringify(patch.removeMcp ?? []),
      "--argjson",
      "addA",
      JSON.stringify(patch.addAgents ?? {}),
      "--argjson",
      "rmA",
      JSON.stringify(patch.removeAgents ?? []),
      "--argjson",
      "addT",
      JSON.stringify(patch.addAgentTools ?? {}),
      "--argjson",
      "rmT",
      JSON.stringify(patch.removeAgentTools ?? {}),
      "--argjson",
      "addI",
      JSON.stringify(patch.addInstructions ?? []),
      "--argjson",
      "rmI",
      JSON.stringify(patch.removeInstructions ?? []),
      opencodePatchProgram(),
      file,
    ])
    return {
      status: result.status,
      stderr: result.stderr.toString(),
      output: result.status === 0 ? JSON.parse(result.stdout.toString()) : null,
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe("opencodePatchProgram", () => {
  test("jq is available", () => {
    if (!hasJq) throw new Error("jq not installed")
  })

  // Regression: a disable of a plugin with opencode.agentTools used to run
  // index() on the glob→bool object and fail with "Cannot index boolean with
  // number", 502ing the disable route and leaving a half-disabled install.
  test("disable patch removes mcp/agents/agentTools/instructions", () => {
    if (!hasJq) return
    const config = {
      plugin: ["@openviking/opencode-plugin"],
      mcp: {
        effectcraft: { type: "local", command: ["bun", "gate.ts"] },
        weather: { type: "remote", url: "https://x" },
      },
      agent: {
        build: { tools: { "effectcraft_*": false, "webfetch_*": true } },
        title: { tools: { "*": false, "effectcraft_*": false } },
        namer: { tools: { "effectcraft_*": false } },
        "effectcraft-worker": { description: "worker" },
        keep: { description: "untouched" },
      },
      instructions: ["a.md", "effectcraft.md", "b.md"],
    } as Record<string, unknown>
    const result = runJq(config, {
      removeMcp: ["effectcraft"],
      removeAgents: ["effectcraft-worker"],
      removeAgentTools: {
        build: { "effectcraft_*": false },
        title: { "effectcraft_*": false },
        namer: { "effectcraft_*": false },
      },
      removeInstructions: ["effectcraft.md"],
    })
    expect(result.stderr).toBe("")
    expect(result.status).toBe(0)
    const out = result.output as Record<string, any>
    expect(Object.keys(out.mcp)).toEqual(["weather"])
    expect(Object.keys(out.agent).sort()).toEqual([
      "build",
      "keep",
      "namer",
      "title",
    ])
    expect(out.agent.build.tools).toEqual({ "webfetch_*": true })
    expect(out.agent.title.tools).toEqual({ "*": false })
    expect(out.agent.namer.tools).toBeUndefined()
    expect(out.instructions).toEqual(["a.md", "b.md"])
    expect(out.plugin).toEqual(["@openviking/opencode-plugin"])
  })

  test("enable patch merges agentTools without touching removals", () => {
    if (!hasJq) return
    const config = {
      plugin: [],
      mcp: {},
      agent: { build: { description: "builder" } },
      instructions: ["a.md"],
    }
    const result = runJq(config, {
      addPlugins: ["some-plugin"],
      addMcp: { weather: { type: "remote", url: "https://x" } },
      addAgents: { worker: { description: "w" } },
      addAgentTools: { build: { "webfetch_*": false } },
      addInstructions: ["plugin.md"],
    })
    expect(result.stderr).toBe("")
    expect(result.status).toBe(0)
    const out = result.output as Record<string, any>
    expect(out.plugin).toEqual(["some-plugin"])
    expect(Object.keys(out.mcp)).toEqual(["weather"])
    expect(out.agent.build.tools).toEqual({ "webfetch_*": false })
    expect(out.instructions).toEqual(["a.md", "plugin.md"])
  })
})
