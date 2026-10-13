import { describe, expect, test } from "bun:test"
import { pluginToolPrefix, stalePluginTools } from "./docker"

describe("plugin tool pruning", () => {
  test("prefix follows the desktop tool convention", () => {
    expect(pluginToolPrefix("stock-pro")).toBe(
      "/usr/local/bin/ob-plugin-stock-pro-",
    )
  })

  test("flags installed names the manifest no longer declares", () => {
    const listing = [
      "/usr/local/bin/ob-plugin-stock-pro-server.js",
      "/usr/local/bin/ob-plugin-stock-pro-fetch.sh",
      "/usr/local/bin/ob-plugin-other-server.js",
      "",
    ].join("\n")
    expect(stalePluginTools("stock-pro", listing, ["server.js"])).toEqual([
      "fetch.sh",
    ])
  })

  test("ignores malformed names, empty suffixes, and keeps declared ones", () => {
    const listing = [
      "/usr/local/bin/ob-plugin-stock-pro-ok.sh",
      "/usr/local/bin/ob-plugin-stock-pro-bad name",
      "/usr/local/bin/ob-plugin-stock-pro-",
      "/usr/local/bin/ob-plugin-stock-pro-.hidden",
    ].join("\n")
    expect(stalePluginTools("stock-pro", listing, ["ok.sh"])).toEqual([
      ".hidden",
    ])
  })

  test("an empty listing prunes nothing", () => {
    expect(stalePluginTools("stock-pro", "", ["a"])).toEqual([])
  })
})
