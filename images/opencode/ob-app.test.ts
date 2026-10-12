import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const script = readFileSync(join(import.meta.dir, "ob-app.sh"), "utf8")

test("ob-app refuses the managed browser and screen infrastructure", () => {
  for (const name of [
    "chromium",
    "chromium-browser",
    "google-chrome",
    "google-chrome-stable",
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
  expect(script).toContain("OB_APP_DESKTOP_DIRS")
  expect(script).toContain("/usr/share/applications")
  expect(script).toContain("~/.local/share/applications")
  expect(script).toContain("NoDisplay")
  expect(script).toContain("Terminal")
  expect(script).toContain(
    `"chromium",
        "chromium-browser",
        "google-chrome",
        "google-chrome-stable",
        "chrome",
        "chrome-sandbox",
    )`,
  )
  // regression: ConfigParser.read() has no errors= kwarg; read_file() does
  expect(script).toContain("cp.read_file(fh)")
  expect(script).not.toContain("cp.read(path")
})

test("usage stays on stderr and catalog needs no session", () => {
  expect(script).toContain("ob-app --session SESSION launch APP [ARG...]")
  expect(script).toContain(
    "ob-app --session SESSION launch chrome [URL] [--profile NAME]",
  )
  expect(script).toMatch(/= "catalog" \] && \[ "\$#" -eq 1 \]/)
})

const python3 = Bun.which("python3")

type CatalogRow = { id: string; name: string; exec: string }

function catalog(dir: string): CatalogRow[] {
  const proc = Bun.spawnSync(
    ["sh", join(import.meta.dir, "ob-app.sh"), "catalog"],
    {
      env: { ...process.env, OB_APP_DESKTOP_DIRS: dir },
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  expect(proc.exitCode).toBe(0)
  return new TextDecoder()
    .decode(proc.stdout)
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as CatalogRow)
}

test.skipIf(!python3)(
  "catalog parses real desktop entries (configparser read_file fix)",
  () => {
    const dir = mkdtempSync(join(tmpdir(), "ob-app-catalog-"))
    writeFileSync(
      join(dir, "blender.desktop"),
      "[Desktop Entry]\nName=Blender\nExec=blender %f\nTerminal=false\nType=Application\n",
    )
    writeFileSync(
      join(dir, "hidden.desktop"),
      "[Desktop Entry]\nName=Hidden App\nExec=nope\nNoDisplay=true\n",
    )
    writeFileSync(
      join(dir, "tui.desktop"),
      "[Desktop Entry]\nName=Tui\nExec=htop\nTerminal=true\n",
    )
    writeFileSync(
      join(dir, "chromium.desktop"),
      "[Desktop Entry]\nName=Managed Browser\nExec=chromium %U\n",
    )
    writeFileSync(
      join(dir, "google-chrome.desktop"),
      "[Desktop Entry]\nName=Google Chrome\nExec=/usr/bin/google-chrome-stable %U\n",
    )
    writeFileSync(join(dir, "broken.desktop"), "garbage [\n")
    const apps = catalog(dir)
    expect(apps).toEqual([
      { id: "chrome", name: "Google Chrome", exec: "__chrome__" },
      { id: "blender", name: "Blender", exec: "blender" },
    ])
  },
)

test.skipIf(!python3)(
  "catalog lets a user desktop entry override a system one",
  () => {
    const system = mkdtempSync(join(tmpdir(), "ob-app-sys-"))
    const user = mkdtempSync(join(tmpdir(), "ob-app-usr-"))
    writeFileSync(
      join(system, "app.desktop"),
      "[Desktop Entry]\nName=System Name\nExec=old\n",
    )
    writeFileSync(
      join(user, "app.desktop"),
      "[Desktop Entry]\nName=User Name\nExec=new\n",
    )
    const apps = catalog(`${system}:${user}`)
    expect(apps).toEqual([
      { id: "chrome", name: "Google Chrome", exec: "__chrome__" },
      { id: "app", name: "User Name", exec: "new" },
    ])
  },
)
