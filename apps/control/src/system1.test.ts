import { expect, test } from "bun:test"
import {
  composeCloudflareEndpoint,
  system1EndpointError,
  system1FieldError,
  system1Providers,
} from "./system1"

test("system1 providers are Cloudflare Jev and self-hosted Laya", () => {
  expect(system1Providers.map((item) => item.id)).toEqual([
    "cloudflare-jev",
    "laya",
  ])
  expect(composeCloudflareEndpoint("acct", "home-ai", "jev")).toBe(
    "https://gateway.ai.cloudflare.com/v1/acct/home-ai/custom-jev/v1/systemone",
  )
  expect(composeCloudflareEndpoint("acct", "home-ai", "custom-jev")).toBe(
    "https://gateway.ai.cloudflare.com/v1/acct/home-ai/custom-jev/v1/systemone",
  )
  expect(composeCloudflareEndpoint("", "home-ai", "jev")).toBe("")
  expect(
    system1EndpointError("cloudflare-jev", "http://example.test/v1/systemone"),
  ).toBe("Cloudflare endpoint must be https")
  expect(
    system1EndpointError(
      "cloudflare-jev",
      "https://gateway.ai.cloudflare.com/v1/{account}/{gateway}/custom-jev/v1/systemone",
    ),
  ).toBe("replace the endpoint placeholders")
  expect(
    system1EndpointError("laya", "http://laya.example:8000/v1/systemone"),
  ).toBeNull()
  expect(
    system1EndpointError("laya", "http://user:pass@laya.example/v1/systemone"),
  ).toBe("endpoint must not include a username or password")
  expect(system1FieldError("slug", "jev")).toBeNull()
  expect(system1FieldError("slug", "bad slug")).toContain("slug")
})
