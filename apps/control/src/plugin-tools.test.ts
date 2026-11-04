import { describe, expect, test } from "bun:test"
import {
  parseSha256Sum,
  pluginToolPrefix,
  sha256Hex,
  stalePluginTools,
} from "./docker"

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

describe("plugin tool copy verification", () => {
  test("sha256Hex hashes the exact installed content", () => {
    expect(sha256Hex("hello\n")).toBe(
      "5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03",
    )
  })

  test("parseSha256Sum reads the digest sha256sum prints", () => {
    const digest = sha256Hex("#!/bin/sh\necho hi\n")
    expect(parseSha256Sum(`${digest}  /usr/local/bin/ob-plugin-x-ctl\n`)).toBe(
      digest,
    )
    expect(parseSha256Sum(`${digest.toUpperCase()} *ctl\n`)).toBe(digest)
    expect(parseSha256Sum("sha256sum: /nope: No such file\n")).toBeNull()
    expect(parseSha256Sum("")).toBeNull()
  })
})
