import { expect, test } from "bun:test"
import { join } from "node:path"

const seed = await Bun.file(join(import.meta.dir, "seed/opencode.json")).json()
const entrypoint = await Bun.file(join(import.meta.dir, "entrypoint.sh")).text()
const bashRules = seed.permission.bash as Record<string, string>

// The bash deny map's port patterns must be anchored to a connection shape
// (":9224", the chrome debugging flag), never to a bare digit substring.
// Field 2026-11-07: the old "*922*" glob denied evidence SHA-256 hashes,
// council UUIDs, hex offsets, and reference counts inside ob-thread post
// message text (the command itself never touched a browser or a port).
//
// Field 2026-11-08: the first anchored attempt used character classes
// ("*:922[0-9]*") — opencode's Wildcard.match escapes "[" and "]" literally,
// so those globs matched nothing and denied no CDP access at all. The ports
// are enumerated exactly with "*" only, the one wildcard the matcher
// translates as "any run of characters" (it also maps "?" to any single
// character; brackets are literals).

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

test("port deny patterns are anchored, not bare substrings or dead classes", () => {
  expect(Object.keys(bashRules)).not.toContain("*922*")
  for (let port = 9222; port <= 9231; port++) {
    expect(bashRules[`*:${port}*`]).toBe("deny")
  }
  expect(bashRules["*remote-debugging-port*"]).toBe("deny")
  // Character classes match nothing in opencode's glob matcher — a bracket in
  // a deny key is a silently dead rule.
  expect(Object.keys(bashRules).some((key) => key.includes("["))).toBe(false)
})

test("real CDP and debugging-port usage stays denied", () => {
  expect(denied("curl http://127.0.0.1:9224/json/list")).toBe(true)
  expect(denied("curl http://localhost:9222/json/version")).toBe(true)
  expect(denied("websocat ws://127.0.0.1:9225/devtools/browser/abc")).toBe(true)
  expect(denied("google-chrome --remote-debugging-port=9222")).toBe(true)
  expect(denied("chromium --remote-debugging-port=9231 about:blank")).toBe(true)
  // Both ends of the enumerated range.
  expect(denied("curl http://127.0.0.1:9231/json")).toBe(true)
})

test("hashes, UUIDs, and counts containing 922 pass through", () => {
  // Every one of these was denied by the old "*922*" substring glob.
  expect(
    denied(
      'ob-thread post ses_1 --message "evidence sha256 a922bf0c21… verified"',
    ),
  ).toBe(false)
  expect(
    denied(
      'ob-thread post ses_1 --message "council d2w-a1 uuid 3f922ab2-7711 member done"',
    ),
  ).toBe(false)
  expect(denied("python3 resolve.py --ordinal 63922 --table npc.txt")).toBe(
    false,
  )
  expect(
    denied('ob-thread post ses_1 --message "4 preuves sur 9223 lignes"'),
  ).toBe(false)
  expect(denied("xxd -s 0x9226b payload.dll")).toBe(false)
  expect(denied("echo total=9223 items")).toBe(false)
})

test("entrypoint takes the deny map from the seed, not a hardcopy", () => {
  expect(entrypoint).toContain(".permission = $seed[0].permission")
  // No third copy of the bash map hiding in the jq merge.
  expect(entrypoint).not.toMatch(/permission.*"bash":\s*{/)
})
