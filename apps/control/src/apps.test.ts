import { describe, expect, test } from "bun:test"
import {
  APP_ID_PATTERN,
  findCatalogApp,
  launchDesktopApp,
  parseAppCatalog,
} from "./apps"

describe("desktop app catalog", () => {
  test("parses one JSON app per line and sorts by name", () => {
    const text = [
      '{"id":"chrome","name":"Google Chrome","exec":"__chrome__"}',
      '{"id":"org.gimp.GIMP","name":"GNU Image Manipulation Program","exec":"gimp-2.10"}',
      '{"id":"xterm","name":"XTerm","exec":"xterm"}',
    ].join("\n")
    const apps = parseAppCatalog(text)
    expect(apps.map((app) => app.id)).toEqual([
      "org.gimp.GIMP",
      "chrome",
      "xterm",
    ])
    expect(apps[0]?.exec).toEqual(["gimp-2.10"])
    expect(apps[1]?.exec).toEqual(["__chrome__"])
  })

  test("strips desktop-exec field codes and splits argv", () => {
    const apps = parseAppCatalog(
      '{"id":"code","name":"Code","exec":"/usr/share/code/code --new-window %U"}',
    )
    expect(apps[0]?.exec).toEqual(["/usr/share/code/code", "--new-window"])
  })

  test("skips junk lines, bad ids, and duplicates", () => {
    const text = [
      "not json",
      '{"id":"has space","name":"Bad","exec":"x"}',
      '{"id":"ok","name":"","exec":"x"}',
      '{"id":"ok","name":"No exec"}',
      '{"id":"ok","name":"First wins","exec":"one"}',
      '{"id":"ok","name":"Second loses","exec":"two"}',
    ].join("\n")
    const apps = parseAppCatalog(text)
    expect(apps).toHaveLength(1)
    expect(apps[0]?.name).toBe("First wins")
  })

  test("finds apps by id and rejects unknown ids", () => {
    const apps = parseAppCatalog('{"id":"xterm","name":"XTerm","exec":"xterm"}')
    expect(findCatalogApp(apps, "xterm")?.name).toBe("XTerm")
    expect(findCatalogApp(apps, "missing")).toBeNull()
    expect(APP_ID_PATTERN.test("org.gimp.GIMP")).toBe(true)
    expect(APP_ID_PATTERN.test("has space")).toBe(false)
    expect(APP_ID_PATTERN.test("../evil")).toBe(false)
  })

  test("launch validates the app id before touching the container", async () => {
    await expect(
      launchDesktopApp("user", "ses_abc", "bad id"),
    ).rejects.toMatchObject({ status: 400 })
  })
})
