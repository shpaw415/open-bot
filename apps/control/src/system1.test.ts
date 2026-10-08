import { expect, test } from "bun:test"
import {
  composeClefEndpoint,
  composeCloudflareEndpoint,
  system1EndpointError,
  system1FieldError,
  system1Providers,
} from "./system1"

test("system1 providers are Cloudflare Jev, Cloudflare Clef, and self-hosted Laya", () => {
  expect(system1Providers.map((item) => item.id)).toEqual([
    "cloudflare-jev",
    "cloudflare-clef",
    "laya",
  ])
  expect(composeCloudflareEndpoint("acct", "home-ai", "jev")).toBe(
    "https://gateway.ai.cloudflare.com/v1/acct/home-ai/custom-jev/v1/systemone",
  )
  expect(composeCloudflareEndpoint("acct", "home-ai", "custom-jev")).toBe(
    "https://gateway.ai.cloudflare.com/v1/acct/home-ai/custom-jev/v1/systemone",
  )
  expect(composeCloudflareEndpoint("", "home-ai", "jev")).toBe("")
  expect(composeClefEndpoint("acct")).toBe(
    "https://api.cloudflare.com/client/v4/accounts/acct/ai/run/@cf/cloudflare/clef",
  )
  expect(composeClefEndpoint("")).toBe("")
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
    system1EndpointError("cloudflare-clef", "http://example.test/ai/run/x"),
  ).toBe("Cloudflare endpoint must be https")
  expect(
    system1EndpointError(
      "cloudflare-clef",
      "https://api.cloudflare.com/client/v4/accounts/{account}/ai/run/@cf/cloudflare/clef",
    ),
  ).toBe("replace the endpoint placeholders")
  expect(
    system1EndpointError(
      "cloudflare-clef",
      "https://api.cloudflare.com/client/v4/accounts/acct/ai/run/@cf/cloudflare/clef",
    ),
  ).toBeNull()
  expect(
    system1EndpointError("laya", "http://laya.example:8000/v1/systemone"),
  ).toBeNull()
  expect(
    system1EndpointError("laya", "http://user:pass@laya.example/v1/systemone"),
  ).toBe("endpoint must not include a username or password")
  expect(system1FieldError("slug", "jev")).toBeNull()
  expect(system1FieldError("slug", "bad slug")).toContain("slug")
})
