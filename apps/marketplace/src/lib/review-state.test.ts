import { describe, expect, test } from "bun:test"
import {
  listingOnEnqueue,
  listingOnVerdict,
  publishShouldPoll,
  reviewPending,
  shouldQueueReview,
} from "./review-state"

const approved = {
  status: "approved" as const,
  latestVersion: "1.0.0",
  securityStatus: "pass",
}

describe("security review queue", () => {
  test("queues only when a binding exists and the host is not loopback", () => {
    expect(shouldQueueReview(false, "market.open-bot.app", undefined)).toBe(
      false,
    )
    expect(shouldQueueReview(true, "127.0.0.1", undefined)).toBe(false)
    expect(shouldQueueReview(true, "market.open-bot.app", undefined)).toBe(true)
    expect(shouldQueueReview(true, "market.open-bot.app", "0")).toBe(false)
    expect(shouldQueueReview(true, "127.0.0.1", "1")).toBe(true)
  })

  test("unlist only the version that is currently listed", () => {
    expect(listingOnEnqueue(null, "1.0.0").listing).toEqual({
      status: "pending",
      latestVersion: "1.0.0",
      securityStatus: "queued",
    })
    expect(listingOnEnqueue(approved, "1.0.0").listing.status).toBe("pending")
    expect(listingOnEnqueue(approved, "1.1.0").touchListing).toBe(false)
  })

  test("moves the listing only after a passing stable review", () => {
    const passed = listingOnVerdict(approved, "1.1.0", false, "pass", 1, 2)
    expect(passed.listing).toEqual({
      status: "approved",
      latestVersion: "1.1.0",
      securityStatus: "pass",
    })
    const stale = listingOnVerdict(approved, "1.1.0", false, "pass", 5, 2)
    expect(stale.touchListing).toBe(false)
    const dev = listingOnVerdict(approved, "beta-1", true, "pass", 1, 2)
    expect(dev.touchListing).toBe(false)
  })

  test("a concern on a newer version does not hide the approved listing", () => {
    expect(
      listingOnVerdict(approved, "1.1.0", false, "concern", 1, 2).touchListing,
    ).toBe(false)
    expect(
      listingOnVerdict(approved, "1.0.0", false, "concern", 1, 2).listing
        .status,
    ).toBe("rejected")
    expect(
      listingOnVerdict(approved, "1.0.0", false, "error", 1, 2).listing.status,
    ).toBe("pending")
  })

  test("treats queued and running as still pending", () => {
    expect(reviewPending("queued")).toBe(true)
    expect(reviewPending("running")).toBe(true)
    expect(reviewPending("pass")).toBe(false)
  })

  test("republish still polls when the previous verdict is error", () => {
    expect(publishShouldPoll("error", "queued")).toBe(true)
    expect(publishShouldPoll("queued", "error")).toBe(true)
    expect(publishShouldPoll("running", "pass")).toBe(true)
    expect(publishShouldPoll("error", "error")).toBe(false)
    expect(publishShouldPoll("pass", "pass")).toBe(false)
    expect(publishShouldPoll("error", "")).toBe(false)
  })
})
