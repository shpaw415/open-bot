import { expect, test } from "bun:test"
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const script = join(import.meta.dir, "ob-report.sh")

function freshDir() {
  const home = mkdtempSync(join(tmpdir(), "ob-report-"))
  return home
}

async function run(home: string, args: string[]) {
  const proc = Bun.spawn(["sh", script, ...args], {
    cwd: home,
    env: {
      ...process.env,
      HOME: home,
      OPEN_BOT_REPORTS_DIR: join(home, "reports"),
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { code, stdout, stderr }
}

function reportFiles(home: string) {
  const dir = join(home, "reports")
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((name) => name.endsWith(".json"))
}

test("add creates a report file and prints the id", async () => {
  const home = freshDir()
  const out = await run(home, [
    "add",
    "--plugin",
    "weather-pro",
    "--kind",
    "bug",
    "--title",
    "ob-weather crashes on empty city",
    "--detail",
    "Expected: noop. Actual: crash.",
  ])
  expect(out.code).toBe(0)
  const parsed = JSON.parse(out.stdout)
  expect(parsed.duplicate).toBe(false)
  expect(parsed.hits).toBe(1)
  expect(reportFiles(home)).toHaveLength(1)
  const row = JSON.parse(
    readFileSync(join(home, "reports", `${parsed.id}.json`), "utf8"),
  )
  expect(row.plugin).toBe("weather-pro")
  expect(row.status).toBe("open")
  expect(row.hits).toBe(1)
  expect(row.note).toBeNull()
})

test("a matching open report gets a hit, not a duplicate", async () => {
  const home = freshDir()
  const args = [
    "add",
    "--plugin",
    "weather-pro",
    "--kind",
    "bug",
    "--title",
    "crashes on empty city",
    "--detail",
    "short",
  ]
  const first = JSON.parse((await run(home, args)).stdout)
  const again = JSON.parse(
    (
      await run(home, [
        "add",
        "--plugin",
        "weather-pro",
        "--kind",
        "bug",
        "--title",
        "  Crashes   on Empty City ",
        "--detail",
        "a much longer detail with the repeat steps written out fully",
      ])
    ).stdout,
  )
  expect(again.id).toBe(first.id)
  expect(again.duplicate).toBe(true)
  expect(again.hits).toBe(2)
  expect(reportFiles(home)).toHaveLength(1)
  const row = JSON.parse(
    readFileSync(join(home, "reports", `${first.id}.json`), "utf8"),
  )
  expect(row.detail).toContain("repeat steps")
})

test("a closed report does not dedupe; the finding reopens as a new row", async () => {
  const home = freshDir()
  const first = JSON.parse(
    (
      await run(home, [
        "add",
        "--plugin",
        "p",
        "--kind",
        "bug",
        "--title",
        "same thing",
        "--detail",
        "d",
      ])
    ).stdout,
  )
  await run(home, ["done", first.id, "--note", "shipped v2"])
  const again = JSON.parse(
    (
      await run(home, [
        "add",
        "--plugin",
        "p",
        "--kind",
        "bug",
        "--title",
        "same thing",
        "--detail",
        "back again",
      ])
    ).stdout,
  )
  expect(again.id).not.toBe(first.id)
  expect(again.duplicate).toBe(false)
  expect(reportFiles(home)).toHaveLength(2)
})

test("list defaults to open, filters and sorts, and --json emits JSONL", async () => {
  const home = freshDir()
  const a = JSON.parse(
    (
      await run(home, [
        "add",
        "--plugin",
        "alpha",
        "--kind",
        "bug",
        "--title",
        "older open",
        "--detail",
        "d",
      ])
    ).stdout,
  )
  const b = JSON.parse(
    (
      await run(home, [
        "add",
        "--plugin",
        "beta",
        "--kind",
        "feature",
        "--title",
        "newer open",
        "--detail",
        "d",
      ])
    ).stdout,
  )
  const closedRow = JSON.parse(
    (
      await run(home, [
        "add",
        "--plugin",
        "alpha",
        "--kind",
        "bug",
        "--title",
        "closed one",
        "--detail",
        "d",
      ])
    ).stdout,
  )
  await run(home, ["done", closedRow.id])
  const closed = await run(home, ["list"])
  expect(closed.stdout).not.toContain("closed one")
  expect(closed.stdout).toContain("older open")

  const all = await run(home, ["list", "--status", "all", "--json"])
  const lines = all.stdout.trim().split("\n")
  expect(lines).toHaveLength(3)
  const ids = lines.map((line) => JSON.parse(line).id)
  expect(ids).toContain(a.id)
  expect(ids).toContain(b.id)
  // make the ordering deterministic: stamp explicit lastSeenAt values
  const { writeFileSync } = await import("node:fs")
  const stamp = (id: string, ts: number) => {
    const path = join(home, "reports", `${id}.json`)
    const row = JSON.parse(readFileSync(path, "utf8"))
    row.lastSeenAt = ts
    writeFileSync(path, JSON.stringify(row))
  }
  stamp(a.id, 1000)
  stamp(b.id, 3000)
  stamp(closedRow.id, 2000)
  const sorted = (await run(home, ["list", "--status", "all", "--json"])).stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line).id)
  expect(sorted).toEqual([b.id, closedRow.id, a.id])

  const plugin = await run(home, [
    "list",
    "--plugin",
    "beta",
    "--status",
    "all",
  ])
  expect(plugin.stdout).toContain("newer open")
  expect(plugin.stdout).not.toContain("older open")

  const kind = await run(home, ["list", "--kind", "feature", "--status", "all"])
  expect(kind.stdout).toContain("newer open")
  expect(kind.stdout).not.toContain("older open")
})

test("show, status flips, and note handling", async () => {
  const home = freshDir()
  const row = JSON.parse(
    (
      await run(home, [
        "add",
        "--plugin",
        "p",
        "--kind",
        "friction",
        "--title",
        "repeats steps",
        "--detail",
        "body text",
        "--session",
        "sess-1",
      ])
    ).stdout,
  )
  const shown = await run(home, ["show", row.id])
  expect(shown.stdout).toContain("body text")
  expect(shown.stdout).toContain("session sess-1")
  expect(shown.code).toBe(0)

  const done = await run(home, ["done", row.id, "--note", "shipped"])
  expect(done.stdout.trim()).toBe(`done ${row.id}`)
  const openList = await run(home, ["list"])
  expect(openList.stdout.trim()).toBe("no reports")
  const allList = await run(home, ["list", "--status", "all"])
  expect(allList.stdout).toContain("done friction/p")

  await run(home, ["open", row.id])
  const reopened = JSON.parse(
    (await run(home, ["list", "--json"])).stdout.trim().split("\n")[0],
  )
  expect(reopened.status).toBe("open")
  expect(reopened.note).toBe("shipped")

  await run(home, ["wontfix", row.id, "--note", ""])
  const cleared = JSON.parse(
    (await run(home, ["list", "--status", "all", "--json"])).stdout,
  )
  expect(cleared.status).toBe("wontfix")
  expect(cleared.note).toBeNull()
})

test("bad input is rejected", async () => {
  const home = freshDir()
  expect(
    (
      await run(home, [
        "add",
        "--plugin",
        "p",
        "--kind",
        "nope",
        "--title",
        "t",
        "--detail",
        "d",
      ])
    ).stderr,
  ).toContain("kind must be")
  expect(
    (
      await run(home, [
        "add",
        "--plugin",
        "bad/slug",
        "--kind",
        "bug",
        "--title",
        "t",
        "--detail",
        "d",
      ])
    ).code,
  ).toBe(1)
  expect(
    (await run(home, ["add", "--plugin", "p", "--kind", "bug"])).code,
  ).toBe(2)
  expect((await run(home, ["show", "../../etc/passwd"])).code).toBe(1)
  expect((await run(home, ["done", "missing-id"])).stderr).toContain(
    "report not found",
  )
  expect(reportFiles(home)).toHaveLength(0)
})

test("the ninth report inside an hour is rate limited", async () => {
  const home = freshDir()
  for (let i = 0; i < 8; i += 1) {
    const out = await run(home, [
      "add",
      "--plugin",
      "p",
      "--kind",
      "bug",
      "--title",
      `report number ${i}`,
      "--detail",
      "d",
    ])
    expect(out.code).toBe(0)
  }
  expect(reportFiles(home)).toHaveLength(8)
  const ninth = await run(home, [
    "add",
    "--plugin",
    "p",
    "--kind",
    "bug",
    "--title",
    "one too many",
    "--detail",
    "d",
  ])
  expect(ninth.code).toBe(1)
  expect(ninth.stderr).toContain("too many new reports this hour")
  expect(reportFiles(home)).toHaveLength(8)
})

test("secrets in title and detail are redacted", async () => {
  const home = freshDir()
  const row = JSON.parse(
    (
      await run(home, [
        "add",
        "--plugin",
        "p",
        "--kind",
        "bug",
        "--title",
        "leak with token=hunter2 inside",
        "--detail",
        "Authorization: Bearer eyJabc.def and sk-abcdef123456 key",
      ])
    ).stdout,
  )
  const body = readFileSync(join(home, "reports", `${row.id}.json`), "utf8")
  expect(body).not.toContain("hunter2")
  expect(body).not.toContain("eyJabc")
  expect(body).not.toContain("sk-abcdef123456")
  expect(body).toContain("[redacted]")
})
