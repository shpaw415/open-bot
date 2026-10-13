import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { HEAL_REASON, healDatabase, healToolPart } from "./heal-stale-tools"

const runningPart = {
  type: "tool",
  tool: "bash",
  callID: "call_x",
  state: {
    status: "running",
    input: { command: "ob-plugin install demo" },
    metadata: { output: "" },
    time: { start: 1_000 },
  },
}

test("flips a running tool part to error and stamps the end time", () => {
  const at = 5_000
  const healed = healToolPart(structuredClone(runningPart), at)
  expect(healed).not.toBeNull()
  const parsed = JSON.parse(healed as string)
  expect(parsed.state.status).toBe("error")
  expect(parsed.state.error).toBe(HEAL_REASON)
  expect(parsed.state.time.start).toBe(1_000)
  expect(parsed.state.time.end).toBe(at)
  expect(parsed.state.input.command).toBe("ob-plugin install demo")
})

test("keeps an existing error message and end time", () => {
  const part = structuredClone(runningPart)
  part.state.error = ""
  const healed = JSON.parse(healToolPart(part, 5_000, "custom") as string)
  expect(healed.state.error).toBe("custom")
  const part2 = structuredClone(runningPart)
  part2.state.time.end = 2_000
  const healed2 = JSON.parse(healToolPart(part2, 5_000) as string)
  expect(healed2.state.time.end).toBe(2_000)
})

test("ignores non-tools and finished tools", () => {
  expect(healToolPart({ type: "text", text: "running" }, 5_000)).toBeNull()
  expect(
    healToolPart({ type: "tool", state: { status: "completed" } }, 5_000),
  ).toBeNull()
  expect(
    healToolPart({ type: "tool", state: { status: "error" } }, 5_000),
  ).toBeNull()
  expect(healToolPart(null, 5_000)).toBeNull()
  expect(healToolPart("nope", 5_000)).toBeNull()
})

test("healDatabase updates only running tool rows", () => {
  const dir = mkdtempSync(join(tmpdir(), "heal-"))
  const dbPath = join(dir, "opencode.db")
  const db = new Database(dbPath)
  db.exec(
    "CREATE TABLE part (id TEXT PRIMARY KEY, data TEXT, time_updated INTEGER)",
  )
  const insert = db.query(
    "INSERT INTO part (id, data, time_updated) VALUES (?, ?, ?)",
  )
  insert.run("p1", JSON.stringify(runningPart), 1_000)
  insert.run(
    "p2",
    JSON.stringify({ type: "text", text: 'status "running"' }),
    1_000,
  )
  insert.run(
    "p3",
    JSON.stringify({ type: "tool", state: { status: "completed" } }),
    1_000,
  )
  insert.run("p4", "not json at all", 1_000)
  db.close()

  const at = 9_000
  expect(healDatabase(dbPath, at)).toBe(1)

  const after = new Database(dbPath, { readonly: true })
  const rows = after
    .query("SELECT id, data, time_updated FROM part ORDER BY id")
    .all() as {
    id: string
    data: string
    time_updated: number
  }[]
  after.close()
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]))
  expect(JSON.parse(byId.p1.data).state.status).toBe("error")
  expect(byId.p1.time_updated).toBe(at)
  expect(byId.p2.data).toBe('{"type":"text","text":"status \\"running\\""}')
  expect(byId.p2.time_updated).toBe(1_000)
  expect(JSON.parse(byId.p3.data).state.status).toBe("completed")
  expect(byId.p4.data).toBe("not json at all")
})

test("cli heals a database file", () => {
  const dir = mkdtempSync(join(tmpdir(), "heal-cli-"))
  const dbPath = join(dir, "opencode.db")
  const db = new Database(dbPath)
  db.exec(
    "CREATE TABLE part (id TEXT PRIMARY KEY, data TEXT, time_updated INTEGER)",
  )
  db.query("INSERT INTO part (id, data, time_updated) VALUES (?, ?, ?)").run(
    "p1",
    JSON.stringify(runningPart),
    1_000,
  )
  db.close()

  const script = new URL("./heal-stale-tools.ts", import.meta.url).pathname
  const proc = Bun.spawnSync(["bun", script, dbPath])
  expect(proc.exitCode).toBe(0)
  expect(proc.stdout.toString()).toContain('"healed":1')

  const after = new Database(dbPath, { readonly: true })
  const row = after.query("SELECT data FROM part WHERE id = 'p1'").get() as {
    data: string
  }
  after.close()
  expect(JSON.parse(row.data).state.status).toBe("error")
})

test("cli is a no-op when the database does not exist", () => {
  const script = new URL("./heal-stale-tools.ts", import.meta.url).pathname
  const proc = Bun.spawnSync(["bun", script, "/nonexistent/opencode.db"])
  expect(proc.exitCode).toBe(0)
  expect(proc.stdout.toString()).toBe("")
})
