import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const src = readFileSync(
  new URL("./ob-origin-export.sh", import.meta.url),
  "utf8",
)

describe("ob-origin-export (#109)", () => {
  test("proves byte-stability with two copies before keeping anything", () => {
    expect(src).toContain('docker cp "$C:$ORIGIN" "$T/a"')
    expect(src).toContain('docker cp "$C:$ORIGIN" "$T/b"')
    expect(src).toContain('cmp -s "$T/a.sha" "$T/b.sha"')
    expect(src).toContain("Nothing was exported")
  })

  test("is read-only on the profile and bounded", () => {
    expect(src).not.toContain('docker exec "$C" sh -lc \'rm')
    expect(src).toContain("OB_ORIGIN_MAX_MB")
    expect(src).toContain("provenance.json")
    expect(src).toContain("MANIFEST.sha256")
  })
})
