import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const script = readFileSync(join(import.meta.dir, "ob-app.sh"), "utf8")

test("ob-app refuses the managed browser and screen infrastructure", () => {
  for (const name of [
    "chromium",
    "google-chrome",
    "chrome-sandbox",
    "Xvfb",
    "x11vnc",
    "websockify",
    "vncdo",
    "xclip",
    "xsel",
    "ttyd",
  ]) {
    expect(script).toContain(name)
  }
})

test("ob-app resolves the display from the vnc host file like ob-vnc", () => {
  expect(script).toContain("/home/agent/.open-bot/vnc/$session")
  expect(script).toContain("computer::590[2-9])")
  expect(script).toContain("- 5900")
  expect(script).not.toContain("5900 + display")
})

test("ob-app validates the session id like ob-vnc", () => {
  expect(script).toContain("*[!A-Za-z0-9_-]*")
  expect(script).toMatch(/\$\{#session\}+" -gt 128/)
})

test("the chrome alias keeps a separate profile and no CDP port", () => {
  expect(script).toContain(".config/apps/chrome")
  expect(script).toContain("--user-data-dir=")
  expect(script).toContain("--password-store=basic")
  expect(script).not.toContain("--remote-debugging-port")
  expect(script).toContain("command -v google-chrome || command -v chromium")
  // the alias only accepts a URL and --profile NAME
  expect(script).toContain("chrome accepts a URL and --profile NAME only")
})

test("chrome profile names are validated like session ids", () => {
  expect(script).toContain('*[!A-Za-z0-9_-]*) echo "bad profile name"')
  expect(script).toMatch(/\$\{#profile_name\}+" -gt 64/)
})

test("launched apps are tracked under the agent home and swept on screen down", () => {
  expect(script).toContain("/home/agent/.open-bot/apps/$session")
  expect(script).toContain('"$apps_dir/$pid.pid"')
  expect(script).toContain('"$apps_dir/$pid.name"')
  const down = readFileSync(join(import.meta.dir, "screen-down.sh"), "utf8")
  expect(down).toContain("/home/agent/.open-bot/apps/$session")
  expect(down).toContain('"$apps_dir"/*.pid')
  expect(down).toContain("/home/agent/.config/apps/chrome/$session")
})

test("launch reports JSON and maximizes through wmctrl", () => {
  expect(script).toContain('"ok":true,"app":"')
  expect(script).toContain("wmctrl -lp")
  expect(script).toContain("-b add,maximized_vert,maximized_horz")
  expect(script).toContain("exited immediately")
})

test("catalog prefers user desktop entries and hides the managed browser", () => {
  expect(script).toContain(
    '{"id":"chrome","name":"Google Chrome","exec":"__chrome__"}',
  )
  expect(script).toContain("/usr/share/applications/*.desktop")
  expect(script).toContain("~/.local/share/applications/*.desktop")
  expect(script).toContain("NoDisplay")
  expect(script).toContain("Terminal")
  expect(script).toContain('in ("chromium", "google-chrome", "chrome")')
})

test("usage stays on stderr and catalog needs no session", () => {
  expect(script).toContain("ob-app --session SESSION launch APP [ARG...]")
  expect(script).toContain(
    "ob-app --session SESSION launch chrome [URL] [--profile NAME]",
  )
  expect(script).toMatch(/= "catalog" \] && \[ "\$#" -eq 1 \]/)
})
