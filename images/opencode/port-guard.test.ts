import { expect, test } from "bun:test"
import { join } from "node:path"

const seed = await Bun.file(join(import.meta.dir, "seed/opencode.json")).json()
const entrypoint = await Bun.file(join(import.meta.dir, "entrypoint.sh")).text()
const bashRules = seed.permission.bash as Record<string, string>

// The config deny map is only a backstop now: real enforcement lives in the
// tool-guards plugin's bashDenial (tool-guards.test.ts), which tokenizes the
// command. What stays here must be host-anchored — never a bare digit or
// executable substring. Field #5/#10/#55/#68/#69: "*:9224*" denied
// checksums ("sha256:9224…") and "*xsel*" denied prose ("prixselection").
//
// Field 2026-11-08: opencode's Wildcard.match escapes "[" and "]"
// literally, so character classes are silently dead rules; ports stay
// enumerated exactly with "*" as the only run wildcard.

// Exact mirror of opencode's Wildcard.match (packages/core/src/util/wildcard.ts,
// verified against v1.19.5): brackets and other regex metacharacters are
// escaped LITERALLY — only "*" (anything) and "?" (one character) are wildcards.
function globToRegex(glob: string) {
  const escaped = glob
    .replaceAll("\\", "/")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")
  return new RegExp(`^${escaped}$`, "s")
}

const denied = (command: string) =>
  Object.entries(bashRules)
    .filter(([, action]) => action === "deny")
    .some(([glob]) => globToRegex(glob).test(command))

test("config port denies are host-anchored, not bare substrings or dead classes", () => {
  expect(Object.keys(bashRules)).not.toContain("*922*")
  for (let port = 9222; port <= 9231; port++) {
    expect(Object.keys(bashRules)).not.toContain(`*:${port}*`)
    expect(bashRules[`*127.0.0.1:${port}*`]).toBe("deny")
    expect(bashRules[`*localhost:${port}*`]).toBe("deny")
  }
  expect(bashRules["*remote-debugging-port*"]).toBe("deny")
  // Character classes match nothing in opencode's glob matcher — a bracket in
  // a deny key is a silently dead rule.
  expect(Object.keys(bashRules).some((key) => key.includes("["))).toBe(false)
  // Executable denies are the plugin's job now; a bare substring key here
  // re-creates the prose/checksum false positives.
  for (const name of [
    "xclip",
    "xsel",
    "chromium",
    "google-chrome",
    "vncdo",
    "websockify",
    "Xvfb",
    "x11vnc",
    "devtools",
  ]) {
    expect(Object.keys(bashRules)).not.toContain(`*${name}*`)
  }
})

test("real CDP endpoint shapes stay denied by the config backstop", () => {
  expect(denied("curl http://127.0.0.1:9224/json/list")).toBe(true)
  expect(denied("curl http://localhost:9222/json/version")).toBe(true)
  expect(denied("websocat ws://127.0.0.1:9225/devtools/browser/abc")).toBe(true)
  expect(denied("google-chrome --remote-debugging-port=9222")).toBe(true)
  expect(denied("curl http://127.0.0.1:9231/json")).toBe(true)
})

test("hashes, checksums, and prose pass the config backstop", () => {
  expect(
    denied('ob-thread post ses_1 --message "authority sha256:9224bf0c21"'),
  ).toBe(false)
  expect(
    denied("python3 prep.py --checksum sha256:9223deadbeef --in artifact"),
  ).toBe(false)
  expect(
    denied('ob-thread post ses_1 --message "prixselection chromium xclip"'),
  ).toBe(false)
  expect(denied("echo total=9223 items")).toBe(false)
  expect(denied("xxd -s 0x9226b payload.dll")).toBe(false)
})

test("entrypoint takes the deny map from the seed, not a hardcopy", () => {
  expect(entrypoint).toContain(".permission = $seed[0].permission")
  // No third copy of the bash map hiding in the jq merge.
  expect(entrypoint).not.toMatch(/permission.*"bash":\s*{/)
})
