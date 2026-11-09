import { expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { bashDenial, ToolGuards } from "./seed/plugins/tool-guards"

type Hooks = {
  "tool.execute.before": (
    input: { tool: string; sessionID: string; callID: string },
    output: { args: Record<string, unknown> },
  ) => Promise<void>
  "tool.execute.after": (
    input: { tool: string; sessionID: string; callID: string },
    output: Record<string, unknown>,
  ) => Promise<void>
}

async function guards(dir: string): Promise<Hooks> {
  return (await ToolGuards({ directory: dir })) as unknown as Hooks
}

function call(tool: string, sessionID: string, callID: string) {
  return { tool, sessionID, callID }
}

test("write refuses an existing file the session never read", async () => {
  const dir = mkdtempSync(join(tmpdir(), "guards-"))
  const file = join(dir, "notes.md")
  writeFileSync(file, "original\n")
  const hooks = await guards(dir)
  await expect(
    hooks["tool.execute.before"](call("write", "s1", "c1"), {
      args: { filePath: file, content: "clobber" },
    }),
  ).rejects.toThrow("read-first")
})

test("write proceeds after the session read the file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "guards-"))
  const file = join(dir, "notes.md")
  writeFileSync(file, "original\n")
  const hooks = await guards(dir)
  await hooks["tool.execute.before"](call("read", "s1", "c1"), {
    args: { filePath: file },
  })
  await hooks["tool.execute.after"](call("read", "s1", "c1"), {})
  await expect(
    hooks["tool.execute.before"](call("write", "s1", "c2"), {
      args: { filePath: file, content: "updated" },
    }),
  ).resolves.toBeUndefined()
})

test("read-first is per session, and new files stay writable", async () => {
  const dir = mkdtempSync(join(tmpdir(), "guards-"))
  const existing = join(dir, "a.md")
  const fresh = join(dir, "b.md")
  writeFileSync(existing, "x\n")
  const hooks = await guards(dir)
  await hooks["tool.execute.before"](call("read", "other", "c1"), {
    args: { filePath: existing },
  })
  await hooks["tool.execute.after"](call("read", "other", "c1"), {})
  // Another session's read does not bless this session's overwrite.
  await expect(
    hooks["tool.execute.before"](call("write", "s1", "c2"), {
      args: { filePath: existing, content: "y" },
    }),
  ).rejects.toThrow("read-first")
  // Creating a new file is fine, and rewriting it later in the same
  // session (it is now a file this session produced) is fine too.
  await hooks["tool.execute.before"](call("write", "s1", "c3"), {
    args: { filePath: fresh, content: "v1" },
  })
  // The real write tool creates the file between the before/after hooks.
  writeFileSync(fresh, "v1\n")
  await hooks["tool.execute.after"](call("write", "s1", "c3"), {})
  await expect(
    hooks["tool.execute.before"](call("write", "s1", "c4"), {
      args: { filePath: fresh, content: "v2" },
    }),
  ).resolves.toBeUndefined()
})

test("write refuses when the file changed since this session read it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "guards-"))
  const file = join(dir, "manifest.json")
  writeFileSync(file, '{"a":1}\n')
  const hooks = await guards(dir)
  await hooks["tool.execute.before"](call("read", "s1", "c1"), {
    args: { filePath: file },
  })
  await hooks["tool.execute.after"](call("read", "s1", "c1"), {})
  // A teammate rewrites the file between this session's read and write —
  // the classic parallel read-modify-write clobber.
  await Bun.sleep(5)
  writeFileSync(file, '{"a":1,"b":2}\n')
  await expect(
    hooks["tool.execute.before"](call("write", "s1", "c2"), {
      args: { filePath: file, content: '{"a":1,"c":3}\n' },
    }),
  ).rejects.toThrow("changed on disk since you read it")
  // Re-reading refreshes the stamp and the write goes through.
  await hooks["tool.execute.before"](call("read", "s1", "c3"), {
    args: { filePath: file },
  })
  await hooks["tool.execute.after"](call("read", "s1", "c3"), {})
  await expect(
    hooks["tool.execute.before"](call("write", "s1", "c4"), {
      args: { filePath: file, content: '{"a":1,"b":2,"c":3}\n' },
    }),
  ).resolves.toBeUndefined()
})

test("grep with a file path is rewritten onto that one file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "guards-"))
  const file = join(dir, "only.log")
  writeFileSync(file, "test result: ok\n")
  const hooks = await guards(dir)
  const output = { args: { pattern: "^test result:", path: file } }
  await hooks["tool.execute.before"](call("grep", "s1", "c1"), output)
  expect(output.args.path).toBe(dir)
  expect(output.args.include).toBe("only.log")
})

test("grep with a directory path is left alone", async () => {
  const dir = mkdtempSync(join(tmpdir(), "guards-"))
  const hooks = await guards(dir)
  const output = { args: { pattern: "x", path: dir } }
  await hooks["tool.execute.before"](call("grep", "s1", "c1"), output)
  expect(output.args).toEqual({ pattern: "x", path: dir })
})

// Field #5/#10/#55/#68/#69: the old glob deny map matched checksums and
// prose. The bash guard parses quotes and command position instead.
test("bash guard denies real CDP, browser, and clipboard invocations", () => {
  expect(bashDenial("curl http://127.0.0.1:9224/json/list")).toContain("9224")
  expect(bashDenial("curl http://localhost:9222/json/version")).toContain(
    "9222",
  )
  expect(
    bashDenial("websocat ws://127.0.0.1:9225/devtools/browser/abc"),
  ).not.toBeNull()
  expect(
    bashDenial("google-chrome --remote-debugging-port=9222 about:blank"),
  ).not.toBeNull()
  expect(bashDenial("chromium --headless about:blank")).toContain("chromium")
  expect(bashDenial("echo hi | xclip -selection clipboard")).toContain("xclip")
  expect(bashDenial("xsel --clipboard --output")).toContain("xsel")
  expect(bashDenial("sudo /usr/bin/vncdo capture out.png")).toContain("vncdo")
  expect(bashDenial("FOO=1 Xvfb :99")).toContain("Xvfb")
  expect(bashDenial("echo $(xclip -o)")).toContain("xclip")
  expect(bashDenial('echo "$(xsel -b)"')).toContain("xsel")
  expect(bashDenial("true; websockify 6080 localhost:5900")).toContain(
    "websockify",
  )
})

test("bash guard allows hashes, checksums, and prose mentioning denied words", () => {
  expect(
    bashDenial(
      'ob-thread post ses_1 --message "authority sha256:9224bf0c21 verified"',
    ),
  ).toBeNull()
  expect(
    bashDenial("python3 prep.py --checksum sha256:9223deadbeef --in artifact"),
  ).toBeNull()
  expect(
    bashDenial(
      'ob-thread post ses_1 --message "le prixselection et chromium capture xclip devtools"',
    ),
  ).toBeNull()
  expect(bashDenial("echo prixselection")).toBeNull()
  expect(bashDenial("grep -r xclip docs/")).toBeNull()
  expect(bashDenial("echo total=9223 items at 12:9223ish")).toBeNull()
  expect(bashDenial("ob-page read")).toBeNull()
})

test("bash hook blocks through tool.execute.before with a compact denial", async () => {
  const dir = mkdtempSync(join(tmpdir(), "guards-"))
  const hooks = await guards(dir)
  await expect(
    hooks["tool.execute.before"](call("bash", "s1", "c1"), {
      args: { command: "xclip -selection clipboard < secret.txt" },
    }),
  ).rejects.toThrow("xclip")
  await expect(
    hooks["tool.execute.before"](call("bash", "s1", "c2"), {
      args: {
        command:
          'ob-thread post ses_1 --message "sha256:9224bf0c prixselection"',
      },
    }),
  ).resolves.toBeUndefined()
})
