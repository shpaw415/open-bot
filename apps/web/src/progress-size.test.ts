import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * mui-lite's CircularProgress takes a numeric `size` in REM (it becomes
 * `--circular-size: ${size}rem`; the library default is 3). Values written
 * as if they were MUI-style pixels — size={14}, size={26} — render as
 * 224px/416px wheels. That shipped once on the thread history sentinel:
 * scrolling up showed a giant loading wheel. Cap numeric sizes at the
 * library default; pixel-intended sizes must use the string form ("14px").
 */
const MAX_REM = 3

describe("CircularProgress numeric sizes are rem, not px", () => {
  test("no numeric size above the library default anywhere in src", () => {
    const dir = import.meta.dir
    const offenders: string[] = []
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".tsx") || name.includes(".test.")) continue
      const source = readFileSync(join(dir, name), "utf8")
      for (const match of source.matchAll(
        /CircularProgress[^>]*?size=\{(\d+(?:\.\d+)?)\}/g,
      )) {
        const value = Number(match[1])
        if (value > MAX_REM)
          offenders.push(`${name}: size={${value}} renders as ${value}rem`)
      }
    }
    expect(offenders).toEqual([])
  })
})
