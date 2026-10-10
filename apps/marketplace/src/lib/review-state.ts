import type { SecurityFinding, SecuritySeverity } from "./security"

export type ReviewPhase = "queued" | "running" | "pass" | "concern" | "error"

export type SecurityReviewMessage = {
  pluginId: string
  version: string
  enqueuedAt: number
}

export type ReviewView = {
  status: ReviewPhase
  severity: SecuritySeverity | null
  findings: SecurityFinding[]
  issueUrl: string | null
  artifactKey: string | null
  artifactSha256: string | null
  error: string | null
}

export type PluginListing = {
  status: "pending" | "approved" | "rejected"
  latestVersion: string
  securityStatus: string | null
}

export type ListingDecision = {
  touchListing: boolean
  listing: PluginListing
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"])

export function shouldQueueReview(
  hasBinding: boolean,
  hostname: string,
  override: string | undefined,
): boolean {
  if (!hasBinding) return false
  if (override === "0") return false
  if (override === "1") return true
  return !LOOPBACK.has(hostname)
}

export function reviewPollPath(pluginId: string, version: string): string {
  const query = new URLSearchParams({ version })
  return `/api/plugins/${encodeURIComponent(pluginId)}/review?${query}`
}

export function reviewPending(status: string | null | undefined): boolean {
  return status === "queued" || status === "running" || status === ""
}

export function publishShouldPoll(
  securityStatus: string | null | undefined,
  reviewStatus: string | null | undefined,
): boolean {
  const pending = (status: string | null | undefined) =>
    status === "queued" || status === "running"
  return pending(securityStatus) || pending(reviewStatus)
}

export function highestSeverity(
  findings: { severity: string }[],
): SecuritySeverity | null {
  let severity: SecuritySeverity | null = null
  for (const finding of findings) {
    if (finding.severity === "high") return "high"
    if (finding.severity === "medium") severity = "medium"
    else if (!severity) severity = "low"
  }
  return severity
}

export function emptyReview(status: "queued" | "running"): ReviewView {
  return {
    status,
    severity: null,
    findings: [],
    issueUrl: null,
    artifactKey: null,
    artifactSha256: null,
    error: null,
  }
}

export function listingOnEnqueue(
  existing: PluginListing | null,
  version: string,
): ListingDecision {
  if (!existing) {
    return {
      touchListing: true,
      listing: {
        status: "pending",
        latestVersion: version,
        securityStatus: "queued",
      },
    }
  }
  if (existing.latestVersion === version) {
    return {
      touchListing: true,
      listing: {
        status: "pending",
        latestVersion: existing.latestVersion,
        securityStatus: "queued",
      },
    }
  }
  return { touchListing: false, listing: existing }
}

export function listingOnVerdict(
  current: PluginListing,
  version: string,
  dev: boolean,
  verdict: "pass" | "concern" | "error",
  currentLatestEnqueuedAt: number | null,
  thisEnqueuedAt: number,
): ListingDecision {
  const listed = current.latestVersion === version
  const keepsPublicListing =
    !listed && current.status === "approved" && verdict !== "pass"
  if (keepsPublicListing) return { touchListing: false, listing: current }

  if (verdict === "pass" && dev && !listed) {
    return { touchListing: false, listing: current }
  }

  if (
    verdict === "pass" &&
    !dev &&
    !listed &&
    (currentLatestEnqueuedAt ?? 0) > thisEnqueuedAt
  ) {
    return { touchListing: false, listing: current }
  }

  if (verdict === "pass") {
    return {
      touchListing: true,
      listing: {
        status: "approved",
        latestVersion: dev ? current.latestVersion : version,
        securityStatus: "pass",
      },
    }
  }

  if (verdict === "concern") {
    return {
      touchListing: true,
      listing: {
        status: "rejected",
        latestVersion: current.latestVersion,
        securityStatus: "concern",
      },
    }
  }

  return {
    touchListing: true,
    listing: {
      status: "pending",
      latestVersion: current.latestVersion,
      securityStatus: "error",
    },
  }
}
