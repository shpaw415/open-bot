import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const script = readFileSync(join(import.meta.dir, "ob-vnc.sh"), "utf8")

// vncdotool resolves a key token as KEYMAP.get(k) or ord(k): a multi-char
// token missing from KEYMAP crashes with "ord() expected a character"
// (vncdotool client.py). Every token the key-normalization case in
// ob-vnc.sh can emit must therefore be a KEYMAP name or a single
// character. List dumped from the image's vncdotool keys.py (2026-11-17).
const VNCDOTOOL_KEYMAP = new Set(
  "alt bslash bsp caplk ctrl del delete down end enter esc f1 f10 f11 f12 f13 f14 f15 f16 f17 f18 f19 f2 f20 f3 f4 f5 f6 f7 f8 f9 fslash home hyper ins kp0 kp1 kp2 kp3 kp4 kp5 kp6 kp7 kp8 kp9 kpenter lalt lctrl left lhyper lmeta lshift lsuper meta minus numlk pause pgdn pgup ralt rctrl return rhyper right rmeta rshift rsuper sb scrlk shift slash space spacebar super sysrq tab up".split(
    " ",
  ),
)

function validVncToken(token: string): boolean {
  if (token.length === 1) return true
  // A chord like ctrl-= splits on '-': every part must resolve.
  return token
    .split("-")
    .every((part) => part.length === 1 || VNCDOTOOL_KEYMAP.has(part))
}

describe("ob-vnc key normalization (#124)", () => {
  test("ctrl-plus normalizes to the single-char equal chord vncdo accepts", () => {
    expect(script).toContain("plus) arg== ;;")
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal shell ${…} expansion in the script under test
    expect(script).toContain('*-plus) arg="${lowered%-plus}-=" ;;')
    expect(script).not.toContain("arg=equal")
    expect(script).not.toContain('-equal"')
  })

  test("every token the normalization case can emit resolves in vncdotool", () => {
    // The last such case is the key-token normalization (an earlier one
    // only rewrites '+' chords to '-' chords, #130).
    const block = script.slice(script.lastIndexOf('case "$lowered" in'))
    const arms = block.slice(0, block.indexOf("esac"))
    const emitted = [
      ...arms.matchAll(/arg="?([^";]+?)"? ;;|arg=([^\s;]+) ;;|arg=\$lowered/g),
    ]
      .map((m) => (m[1] ?? m[2] ?? "").trim())
      .filter(Boolean)
    expect(emitted.length).toBeGreaterThan(5)
    for (const token of emitted) {
      // The *) arm passes the user's own lowercased token through; only
      // tokens this script itself invents are checked here.
      if (token === "$lowered") continue
      // *-plus emits "<prefix>-=": the prefix is the user's modifier.
      // biome-ignore lint/suspicious/noTemplateCurlyInString: literal shell ${…} expansion in the script under test
      const concrete = token.replace("${lowered%-plus}", "ctrl")
      expect(validVncToken(concrete)).toBe(true)
    }
    expect(validVncToken("ctrl-=")).toBe(true)
    expect(validVncToken("ctrl-equal")).toBe(false)
    expect(validVncToken("ctrl-plus")).toBe(false)
  })

  test("xkey translates whole chords to xdotool keysyms (#130)", () => {
    const fn = script.slice(script.indexOf("xkey()"))
    const body = fn.slice(0, fn.indexOf("\n}\n") + 2)
    // Include any xkey_* helpers defined right before xkey.
    const helpers = script.slice(0, script.indexOf("xkey()"))
    const helperStart = helpers.lastIndexOf("xkey_one()")
    const prelude = helperStart >= 0 ? helpers.slice(helperStart) : ""
    const run = (token: string) => {
      const proc = Bun.spawnSync([
        "sh",
        "-c",
        `${prelude}${body}\nxkey "$1"`,
        "sh",
        token,
      ])
      expect(proc.exitCode).toBe(0)
      return new TextDecoder().decode(proc.stdout)
    }
    expect(run("ctrl-plus")).toBe("ctrl+equal")
    expect(run("ctrl-=")).toBe("ctrl+equal")
    expect(run("ctrl-0")).toBe("ctrl+0")
    expect(run("shift-tab")).toBe("shift+Tab")
    expect(run("shift+tab")).toBe("shift+Tab")
    expect(run("tab")).toBe("Tab")
    expect(run("enter")).toBe("Return")
    expect(run("ctrl-a")).toBe("ctrl+a")
  })

  test("xdotool fallback translates the equal chord to its keysym name", () => {
    const xkey = script.slice(script.indexOf("xkey_one()"))
    const body = xkey.slice(0, xkey.indexOf("\n}\n"))
    expect(body).toContain("equal")
    expect(body).toContain("plus")
  })
})
