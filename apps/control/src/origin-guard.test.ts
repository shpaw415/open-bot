import { expect, test } from "bun:test"
import { effectiveProto, insecureRedirect } from "./origin-guard"

const canonical = "https://bot.example.com"

test("a spoofed x-forwarded-proto on the internal origin is ignored (#105)", () => {
  expect(
    effectiveProto(
      { forwardedProto: "https", host: "100.96.0.3:8787", protocol: "http:" },
      { canonicalOrigin: canonical, trustProxy: false },
    ),
  ).toBe("http")
})

test("x-forwarded-proto counts on the canonical host or with explicit proxy trust", () => {
  expect(
    effectiveProto(
      { forwardedProto: "https", host: "bot.example.com", protocol: "http:" },
      { canonicalOrigin: canonical, trustProxy: false },
    ),
  ).toBe("https")
  expect(
    effectiveProto(
      { forwardedProto: "https", host: "anything", protocol: "http:" },
      { canonicalOrigin: "", trustProxy: true },
    ),
  ).toBe("https")
  // No header: the direct scheme decides.
  expect(
    effectiveProto(
      { forwardedProto: null, host: "bot.example.com", protocol: "https:" },
      { canonicalOrigin: canonical, trustProxy: false },
    ),
  ).toBe("https")
})

test("browser GETs on an insecure origin redirect to the canonical https origin", () => {
  expect(
    insecureRedirect(
      { method: "GET", pathname: "/chat", search: "?t=1", proto: "http" },
      canonical,
    ),
  ).toBe("https://bot.example.com/chat?t=1")
  // API calls and non-GETs never redirect; https canonical only.
  expect(
    insecureRedirect(
      { method: "GET", pathname: "/api/me", search: "", proto: "http" },
      canonical,
    ),
  ).toBeNull()
  expect(
    insecureRedirect(
      {
        method: "POST",
        pathname: "/api/auth/login",
        search: "",
        proto: "http",
      },
      canonical,
    ),
  ).toBeNull()
  expect(
    insecureRedirect(
      { method: "GET", pathname: "/", search: "", proto: "https" },
      canonical,
    ),
  ).toBeNull()
  expect(
    insecureRedirect(
      { method: "GET", pathname: "/", search: "", proto: "http" },
      "http://bot.example.com",
    ),
  ).toBeNull()
  expect(
    insecureRedirect(
      { method: "GET", pathname: "/", search: "", proto: "http" },
      "",
    ),
  ).toBeNull()
})
