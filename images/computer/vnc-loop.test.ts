import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const script = join(import.meta.dir, "vnc-loop.sh")

const REQUIRED = ["-noshm", "-snapfb", "-rfbport", "-forever", "-shared"]

const REMOVED = [
  "-quality",
  "-hints",
  "-nohints",
  "-cursorposall",
  "-nofilexfer",
  "-old_copytile",
  "-mouse",
  "-nomouse",
  "-old_pointer",
]

export function x11vncArgv(text: string): string[] {
  const match = /x11vnc\s+([^\n]+?)\s*\|\|\s*true/.exec(text)
  if (!match) throw new Error("no x11vnc || true command in vnc-loop.sh")
  const tokens = match[1].match(/"[^"]*"|'[^']*'|\S+/g) ?? []
  return tokens.map((token) => token.replace(/^["']|["']$/g, ""))
}

export function unknownFlags(argv: string[], help: string): string[] {
  return argv.filter((token) => {
    if (!token.startsWith("-")) return false
    const name = token.slice(1).split("=")[0]
    return !help.includes(name)
  })
}

function x11vncHelpCommand(): string[] | null {
  if (Bun.which("x11vnc")) return ["x11vnc", "-help"]
  const image = Bun.spawnSync([
    "docker",
    "image",
    "inspect",
    "open-bot-computer:local",
    "--format",
    "ok",
  ])
  if (image.exitCode === 0) {
    return [
      "docker",
      "run",
      "--rm",
      "--entrypoint",
      "x11vnc",
      "open-bot-computer:local",
      "-help",
    ]
  }
  return null
}

const helpCommand = x11vncHelpCommand()

test("vnc-loop keeps the required x11vnc options", () => {
  const argv = x11vncArgv(readFileSync(script, "utf8"))
  for (const flag of REQUIRED) {
    expect(argv).toContain(flag)
  }
})

test("vnc-loop never passes removed x11vnc options", () => {
  const argv = x11vncArgv(readFileSync(script, "utf8"))
  const bad = argv.filter((token) => REMOVED.includes(token))
  expect(bad).toEqual([])
})

test("detector catches the -quality 9 regression", () => {
  const broken = [
    "#!/bin/sh",
    "while true; do",
    "  x11vnc -display :2 -rfbport 5902 -nopw -shared -forever -noxdamage -noshm -snapfb -quality 9 || true",
    "  sleep 2",
    "done",
    "",
  ].join("\n")
  const help =
    "usage: x11vnc -display -rfbport -nopw -shared -forever -noxdamage -noshm -snapfb"
  expect(unknownFlags(x11vncArgv(broken), help)).toEqual(["-quality"])
})

test.skipIf(!helpCommand)(
  "every x11vnc option in vnc-loop.sh exists in the shipping x11vnc",
  async () => {
    const proc = Bun.spawn(helpCommand as string[], {
      stdout: "pipe",
      stderr: "pipe",
    })
    const [out, err] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])
    await proc.exited
    const help = `${out}\n${err}`
    expect(help.length).toBeGreaterThan(1000)
    const argv = x11vncArgv(readFileSync(script, "utf8"))
    expect(unknownFlags(argv, help)).toEqual([])
  },
)
