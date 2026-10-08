import { randomToken } from "./passwords"

export type ApprovalAction =
  | { kind: "reset" }
  | { kind: "restore"; backupId: string }

export type ApprovalResult = {
  state: "running" | "done" | "failed"
  error: string | null
  detail?: string | null
}

export type ResetApproval = {
  id: string
  userId: string
  action: ApprovalAction
  label: string
  createdAt: number
  expiresAt: number
  attempts: number
  status: "pending" | "approved" | "denied" | "expired"
  result: ApprovalResult | null
}

export const APPROVAL_TTL_MS = 5 * 60 * 1000
export const APPROVAL_MAX_ATTEMPTS = 5

const attemptsLimit = APPROVAL_MAX_ATTEMPTS

/**
 * In-memory registry of desktop reset/restore approvals. Losing pending
 * requests on a control-plane restart is the safe default: the agent's CLI
 * sees the request expire and must ask again.
 */
export class ResetApprovals {
  private pending = new Map<string, ResetApproval>()

  create(userId: string, action: ApprovalAction): ResetApproval {
    for (const record of this.pending.values()) {
      if (record.userId !== userId || record.status !== "pending") continue
      // Keep the replaced record visible as expired so anyone polling it
      // sees a terminal state instead of a 404.
      record.status = "expired"
    }
    const record: ResetApproval = {
      id: randomToken(),
      userId,
      action,
      label:
        action.kind === "restore"
          ? `restore backup ${action.backupId}`
          : "factory reset desktop",
      createdAt: Date.now(),
      expiresAt: Date.now() + APPROVAL_TTL_MS,
      attempts: 0,
      status: "pending",
      result: null,
    }
    this.pending.set(record.id, record)
    return record
  }

  get(id: string, userId: string): ResetApproval | null {
    const record = this.pending.get(id)
    if (!record || record.userId !== userId) return null
    if (
      record.status === "pending" &&
      Date.now() > record.expiresAt &&
      record.result === null
    ) {
      record.status = "expired"
    }
    return record
  }

  approve(
    id: string,
    userId: string,
    password: string,
    verify: (password: string, stored: string) => boolean,
    storedHash: string | null,
  ): { error?: string; record?: ResetApproval } {
    const record = this.get(id, userId)
    if (!record) return { error: "request not found" }
    if (record.status !== "pending")
      return { error: `request is ${record.status}` }
    if (Date.now() > record.expiresAt) {
      record.status = "expired"
      return { error: "request expired" }
    }
    if (!storedHash || !verify(password, storedHash)) {
      record.attempts += 1
      if (record.attempts >= attemptsLimit) {
        record.status = "expired"
        return { error: "too many wrong passwords; request expired" }
      }
      return { error: "wrong password" }
    }
    record.status = "approved"
    record.result = { state: "running", error: null }
    return { record }
  }

  deny(id: string, userId: string): { error?: string; record?: ResetApproval } {
    const record = this.get(id, userId)
    if (!record) return { error: "request not found" }
    if (record.status !== "pending")
      return { error: `request is ${record.status}` }
    record.status = "denied"
    return { record }
  }

  setResult(id: string, result: ApprovalResult) {
    const record = this.pending.get(id)
    if (record) record.result = result
  }

  /** Drop resolved records older than an hour to keep memory bounded. */
  sweep() {
    const cutoff = Date.now() - 60 * 60 * 1000
    for (const [id, record] of this.pending) {
      if (record.status === "pending") continue
      if ((record.result ? record.expiresAt : record.createdAt) < cutoff)
        this.pending.delete(id)
    }
  }
}

export function approvalSummary(record: ResetApproval) {
  return {
    id: record.id,
    kind: record.action.kind,
    backupId: record.action.kind === "restore" ? record.action.backupId : null,
    label: record.label,
    status: record.status,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    attempts: record.attempts,
    result: record.result,
  }
}
