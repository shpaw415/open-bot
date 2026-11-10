import { describe, expect, test } from "bun:test"
import { dashboardOriginGate } from "./env"

describe("dashboard origin gate (#105)", () => {
  const base = {
    method: "GET",
    pathname: "/",
    proto: "http",
    secure: true,
    publicUrl: "https://open-bot.example.com",
  }
  test("redirects insecure document requests to the canonical https origin", () => {
    expect(dashboardOriginGate(base)).toEqual({
      action: "redirect",
      to: "https://open-bot.example.com/",
    })
    expect(dashboardOriginGate({ ...base, pathname: "/threads/abc" })).toEqual({
      action: "redirect",
      to: "https://open-bot.example.com/threads/abc",
    })
  })
  test("blocks with an HTTPS-required page when no secure origin is configured", () => {
    expect(dashboardOriginGate({ ...base, publicUrl: "" })).toEqual({
      action: "block",
    })
    expect(
      dashboardOriginGate({ ...base, publicUrl: "http://100.96.0.3:3005" }),
    ).toEqual({ action: "block" })
  })
  test("never gates https traffic, non-secure deployments, APIs, or assets", () => {
    expect(dashboardOriginGate({ ...base, proto: "https" })).toBeNull()
    expect(dashboardOriginGate({ ...base, secure: false })).toBeNull()
    expect(
      dashboardOriginGate({ ...base, pathname: "/api/threads" }),
    ).toBeNull()
    expect(
      dashboardOriginGate({ ...base, pathname: "/assets/app.js" }),
    ).toBeNull()
    expect(dashboardOriginGate({ ...base, method: "POST" })).toBeNull()
  })
})
