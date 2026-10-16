// Docs-drift harness (Plugin Workflow Council DOC1/DOC2/DOC4): platform
// truth lives in plugin-kit — every prose surface that repeats it must stay
// in sync or this file fails. Covers:
//  1. Every fenced jsonc manifest in the root README validates (the first
//     thing a human copies must be tested like code).
//  2. The ob-plugin.sh scaffold/quick-reference teaches the review windows,
//     the tab kinds, the typed configs, and the cron run modes the
//     validator actually enforces.
//  3. The docs site teaches the lazy page-server lifecycle and the real
//     port range (4740-4759), never the pre-lazy wording.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  REVIEW_MANIFEST_CHARS,
  REVIEW_PAYLOAD_FILE_CHARS,
  REVIEW_PAYLOAD_TOTAL_CHARS,
  REVIEW_TAR_PATH_MAX,
  validatePluginManifest,
} from "./manifest"

const repoRoot = join(import.meta.dir, "../../..")

function fencedJsoncBlocks(text: string): string[] {
  const blocks: string[] = []
  const pattern = /```jsonc\n([\s\S]*?)```/g
  for (const match of text.matchAll(pattern)) {
    blocks.push(match[1] ?? "")
  }
  return blocks
}

// jsonc: strip // comments, then tighten it into strict JSON.
function parseJsonc(text: string): unknown {
  const stripped = text
    .split("\n")
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, "$1"))
    .join("\n")
  return JSON.parse(stripped)
}

describe("docs drift", () => {
  test("every fenced manifest in the root README validates", () => {
    const readme = readFileSync(join(repoRoot, "README.md"), "utf8")
    const manifests = fencedJsoncBlocks(readme).filter(
      (block) => block.includes('"id"') && block.includes('"repo"'),
    )
    expect(manifests.length).toBeGreaterThan(0)
    for (const block of manifests) {
      const parsed = parseJsonc(block)
      const result = validatePluginManifest(parsed)
      expect(
        result.ok
          ? true
          : result.issues.map((issue) => `${issue.path}: ${issue.message}`),
      ).toBe(true)
    }
  })

  test("ob-plugin.sh teaches the review windows and validator shapes", () => {
    const cli = readFileSync(join(repoRoot, "scripts/ob-plugin.sh"), "utf8")
    // Review windows mirror the constants (the CLI hardcodes them for
    // pre-flight checks; keep the two surfaces in sync).
    expect(cli).toContain(
      `REVIEW_PAYLOAD_FILE_CHARS=${REVIEW_PAYLOAD_FILE_CHARS}`,
    )
    expect(cli).toContain(
      `REVIEW_PAYLOAD_TOTAL_CHARS=${REVIEW_PAYLOAD_TOTAL_CHARS}`,
    )
    expect(cli).toContain(`REVIEW_MANIFEST_CHARS=${REVIEW_MANIFEST_CHARS}`)
    expect(cli).toContain(`REVIEW_TAR_PATH_MAX=${REVIEW_TAR_PATH_MAX}`)
    // The scaffold quick-reference documents the shapes the validator
    // enforces — the stale lines that inspired this harness must not return.
    expect(cli).toContain("kind: app|page|iframe")
    expect(cli).toContain("run?: prompt|script|both|auto")
    expect(cli).toContain("type?: string|bool|number|enum")
    expect(cli).toContain("hooks[]: {event: session.idle|thread.created")
  })

  test("the docs site teaches the lazy page-server lifecycle and real ports", () => {
    const mdx = readFileSync(
      join(repoRoot, "apps/doc/src/pages/docs/plugins.mdx"),
      "utf8",
    )
    expect(mdx).toContain("4740–4759")
    expect(mdx).not.toContain("4740-4719")
    expect(mdx).toContain("Fully lazy")
    expect(mdx).not.toContain("run by the control plane at install")
  })
})
