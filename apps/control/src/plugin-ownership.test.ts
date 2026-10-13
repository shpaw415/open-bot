import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { emptyAppliedLog, openDatabase } from "@open-bot/db"
import {
  cronOwnedPluginId,
  pluginOriginForCronJob,
  pluginOwnership,
} from "./plugin-ownership"

function open() {
  return openDatabase(join(mkdtempSync(join(tmpdir(), "ob-")), "bot.sqlite"))
}

function install(
  db: ReturnType<typeof openDatabase>,
  pluginId: string,
  name: string,
  applied: Partial<ReturnType<typeof emptyAppliedLog>> = {},
) {
  db.createUser({
    id: "u",
    email: `${pluginId}@localhost`,
    passwordHash: "hash",
    role: "user",
    createdAt: 1,
    mustChangePassword: false,
    disabled: false,
  })
  db.createInstalledPlugin({
    id: `row-${pluginId}`,
    userId: "u",
    pluginId,
    version: "1.0.0",
    manifest: JSON.stringify({ id: pluginId, name }),
    readme: null,
    enabled: true,
    source: "marketplace",
    localPath: null,
    applied: "{}",
    createdAt: 1,
    updatedAt: 1,
  })
  db.setInstalledPluginApplied("u", pluginId, {
    ...emptyAppliedLog(),
    ...applied,
  })
}

describe("pluginOwnership", () => {
  test("maps applied persona ids and skill names to the plugin", () => {
    const db = open()
    install(db, "weather-pro", "Weather Pro", {
      personaIds: ["p1"],
      skills: ["weather-report"],
    })
    const ownership = pluginOwnership(db, "u")
    expect(ownership.personaById.get("p1")).toEqual({
      id: "weather-pro",
      name: "Weather Pro",
    })
    expect(ownership.skillByName.get("weather-report")).toEqual({
      id: "weather-pro",
      name: "Weather Pro",
    })
    expect(ownership.personaById.get("p2")).toBeUndefined()
    expect(ownership.skillByName.get("other-skill")).toBeUndefined()
  })

  test("falls back to the plugin id when the manifest has no name", () => {
    const db = open()
    install(db, "weather-pro", "")
    const ownership = pluginOwnership(db, "u")
    expect(ownership.cronByPluginId.get("weather-pro")).toEqual({
      id: "weather-pro",
      name: "weather-pro",
    })
  })

  test("covers disabled plugins and other users stay isolated", () => {
    const db = open()
    install(db, "weather-pro", "Weather Pro", { personaIds: ["p1"] })
    db.setInstalledPluginEnabled("u", "weather-pro", false)
    expect(pluginOwnership(db, "u").personaById.get("p1")).toBeDefined()
    expect(pluginOwnership(db, "missing").personaById.get("p1")).toBeUndefined()
  })
})

describe("pluginOriginForCronJob", () => {
  test("resolves the plugin:<id>: name prefix to an installed plugin", () => {
    const db = open()
    install(db, "weather-pro", "Weather Pro")
    const ownership = pluginOwnership(db, "u")
    expect(
      pluginOriginForCronJob(ownership, "plugin:weather-pro:daily-report"),
    ).toEqual({ id: "weather-pro", name: "Weather Pro" })
    expect(
      pluginOriginForCronJob(ownership, "plugin:weather-pro:guard"),
    ).toEqual({ id: "weather-pro", name: "Weather Pro" })
  })

  test("ignores plain names and prefixes without an installed plugin", () => {
    const db = open()
    install(db, "weather-pro", "Weather Pro")
    const ownership = pluginOwnership(db, "u")
    expect(pluginOriginForCronJob(ownership, "daily-report")).toBeNull()
    expect(pluginOriginForCronJob(ownership, "plugin:ghost:daily")).toBeNull()
    expect(cronOwnedPluginId("plugin:weather-pro:daily-report")).toBe(
      "weather-pro",
    )
    expect(cronOwnedPluginId("daily-report")).toBeNull()
  })
})
