import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * The thread log's floating pills (Jump to latest, Councils) sit in
 * zero-height sticky wrappers: the pill overflows downward from the
 * wrapper's sticky line, so the wrapper's `bottom` must cover the
 * pill's own height (~34px) plus clearance — at 10px the pill slid
 * under the composer below the log and was clipped by it.
 */
function bottomOf(css: string, selector: string): number {
  const block = css.match(new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`))
  const bottom = block?.[1]?.match(/bottom:\s*(\d+(?:\.\d+)?)px/)
  return bottom ? Number(bottom[1]) : Number.NaN
}

describe("sticky log pills clear the composer", () => {
  const css = readFileSync(join(import.meta.dir, "app.css"), "utf8")

  test("wrapper bottoms cover the pill height plus clearance", () => {
    // ~34px pill + at least ~10px clear of the log's bottom edge.
    expect(bottomOf(css, ".ob-jump-wrap")).toBeGreaterThanOrEqual(44)
    expect(bottomOf(css, ".ob-councils-fab-wrap")).toBeGreaterThanOrEqual(44)
  })

  test("narrow screens stack Councils one line above Jump to latest", () => {
    const jump = bottomOf(css, ".ob-jump-wrap")
    const narrow = css.match(
      /@media \(max-width: 599px\) \{\s*\.ob-councils-fab-wrap \{\s*bottom: (\d+(?:\.\d+)?)px/,
    )
    expect(narrow).not.toBeNull()
    expect(Number(narrow?.[1])).toBeGreaterThanOrEqual(jump + 40)
  })
})
