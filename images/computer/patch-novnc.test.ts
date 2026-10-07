import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const script = join(import.meta.dir, "patch-novnc.py")

const ui = `import * as WebUtil from "./webutil.js";

    keyboardinputReset() {
        const kbi = document.getElementById('noVNC_keyboardinput');
        kbi.value = new Array(UI.defaultKeyboardinputLen).join("_");
        UI.lastKeyboardinput = kbi.value;
    },

    keyEvent(keysym, code, down) {
        if (!UI.rfb) return;

        UI.rfb.sendKey(keysym, code, down);
    },

    keyInput(event) {

        if (!UI.rfb) return;

        const newValue = event.target.value;

        for (let i = newLen - inputs; i < newLen; i++) {
            UI.rfb.sendKey(keysyms.lookup(newValue.charCodeAt(i)));
        }
    },
`

test("patches the noVNC keyboard baseline", async () => {
  const root = mkdtempSync(join(tmpdir(), "ob-novnc-"))
  mkdirSync(join(root, "app"))
  writeFileSync(join(root, "app", "ui.js"), ui)
  writeFileSync(
    join(root, "vnc.html"),
    '<script type="module" crossorigin="anonymous" src="app/ui.js"></script>\n',
  )
  const proc = Bun.spawn(["python3", script, root], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stderr, code] = await Promise.all([
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  expect({ code, stderr }).toEqual({ code: 0, stderr: "" })
  const patched = readFileSync(join(root, "app", "ui.js"), "utf8")
  expect(patched).toContain('from "./android-keys.js"')
  expect(patched).not.toContain('join("_")')
  expect(patched).toContain("ignoreAndroidUnderscore")
  expect(patched).toContain("androidActions")
  expect(patched).toContain("PAD_CODE")
  const html = readFileSync(join(root, "vnc.html"), "utf8")
  expect(html).toContain("app/ui.js?v=android-keys")
})
