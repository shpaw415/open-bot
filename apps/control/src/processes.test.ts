import { describe, expect, spyOn, test } from "bun:test"
import * as docker from "./docker"
import {
  desktopProcesses,
  killDesktopProcess,
  parseProcessList,
} from "./processes"

const validRow = {
  id: "p-1a2b3c4d",
  name: "webapp",
  session: "ses_123",
  cmd: "bun run dev",
  pid: 4242,
  startedAt: 1700000000000,
  uptimeSeconds: 65,
  cpuPercent: 3.4,
  rssBytes: 123456789,
}

function execResult(stdout: string, code = 0, stderr = "") {
  return { code, stdout, stderr }
}

describe("parseProcessList", () => {
  test("keeps valid rows and skips junk", () => {
    const text = JSON.stringify([
      validRow,
      { id: "nope" },
      null,
      "x",
      { ...validRow, id: "BAD", name: "x" },
      { ...validRow, id: "p-ffffffff", pid: 0 },
    ])
    const rows = parseProcessList(text)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe("p-1a2b3c4d")
    expect(rows[0]?.name).toBe("webapp")
    expect(rows[0]?.cpuPercent).toBe(3.4)
  })

  test("garbage output parses as empty", () => {
    expect(parseProcessList("")).toEqual([])
    expect(parseProcessList("not json")).toEqual([])
    expect(parseProcessList("{}")).toEqual([])
  })

  test("missing metrics degrade to null, never crash", () => {
    const rows = parseProcessList(
      JSON.stringify([
        {
          id: "p-00000001",
          name: "srv",
          pid: 7,
          cmd: "",
          startedAt: 0,
        },
      ]),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.cpuPercent).toBeNull()
    expect(rows[0]?.rssBytes).toBeNull()
    expect(rows[0]?.session).toBe("unknown")
  })

  test("rows sort by start time and duplicate ids collapse", () => {
    const rows = parseProcessList(
      JSON.stringify([
        { ...validRow, startedAt: 200 },
        { ...validRow, id: "p-00000002", startedAt: 100 },
        { ...validRow },
      ]),
    )
    expect(rows.map((row) => row.id)).toEqual(["p-00000002", "p-1a2b3c4d"])
  })
})

describe("control routes ride opencodeExec on the shim", () => {
  test("list execs ob-process list --json and parses", async () => {
    const spy = spyOn(docker, "opencodeExec").mockImplementation(async () =>
      execResult(JSON.stringify([validRow])),
    )
    try {
      const rows = await desktopProcesses("u1")
      expect(rows).toHaveLength(1)
      expect(spy.mock.calls[0]).toEqual([
        "u1",
        ["/usr/local/bin/ob-process", "list", "--json"],
      ])
    } finally {
      spy.mockRestore()
    }
  })

  test("kill validates the id before exec", async () => {
    const spy = spyOn(docker, "opencodeExec").mockImplementation(async () =>
      execResult('{"ok":true,"id":"p-1a2b3c4d","killed":true}'),
    )
    try {
      await expect(killDesktopProcess("u1", "../etc/passwd")).rejects.toThrow(
        "bad process id",
      )
      expect(spy.mock.calls).toHaveLength(0)
      await killDesktopProcess("u1", "p-1a2b3c4d")
      expect(spy.mock.calls[0]).toEqual([
        "u1",
        ["/usr/local/bin/ob-process", "kill", "p-1a2b3c4d"],
      ])
    } finally {
      spy.mockRestore()
    }
  })

  test("a missing shim points at the image update", async () => {
    const spy = spyOn(docker, "opencodeExec").mockImplementation(async () =>
      execResult("", 127, "sh: /usr/local/bin/ob-process: not found"),
    )
    try {
      await expect(desktopProcesses("u1")).rejects.toThrow(
        "update the desktop image",
      )
    } finally {
      spy.mockRestore()
    }
  })
})
