"no action"

import { adminAuthorized, marketplaceWriteAuth } from "../../lib/auth"
import {
  fileMarketplaceIssue,
  ISSUE_STATUSES,
  issuesSchemaSelfCheck,
  listIssues,
} from "../../lib/issues"

// Product-report issues relayed from open-bot instances (ob-improve).
// POST creates one (instance write auth, like plugin comments): the
// marketplace dedupes by fingerprint, pushes a new issue to the relevant
// GitHub repo, and returns the stored row. GET lists them for the admin
// manage API; per-issue management lives in ./issues/[id].

// Admin view of the queue: ?status=open|done|wontfix|all (default open),
// ?pluginId=, ?limit= (default 100, max 200).
export async function onRequestGet(context: EventContext<Env, never, never>) {
  const schema = await issuesSchemaSelfCheck(context.env.DB)
  if (!schema.ok) {
    return Response.json(
      { error: schema.error, code: "migration_missing" },
      { status: 503 },
    )
  }
  if (!(await adminAuthorized(context.request, context.env.ADMIN_TOKEN))) {
    return Response.json({ error: "unauthorized" }, { status: 401 })
  }
  const url = new URL(context.request.url)
  const status = url.searchParams.get("status") ?? "open"
  if (
    status !== "all" &&
    !(ISSUE_STATUSES as readonly string[]).includes(status)
  ) {
    return Response.json(
      { error: "status must be open, done, wontfix, or all" },
      { status: 400 },
    )
  }
  const limit = Number(url.searchParams.get("limit") ?? 100)
  const issues = await listIssues(context.env.DB, {
    status,
    pluginId: url.searchParams.get("pluginId") ?? undefined,
    limit: Number.isFinite(limit) ? limit : 100,
  })
  return Response.json({ issues })
}

export async function onRequestPost(context: EventContext<Env, never, never>) {
  const schema = await issuesSchemaSelfCheck(context.env.DB)
  if (!schema.ok) {
    return Response.json(
      { error: schema.error, code: "migration_missing" },
      { status: 503 },
    )
  }
  const writer = await marketplaceWriteAuth(
    context.env.DB,
    context.request,
    context.env.MARKETPLACE_TOKEN,
  )
  if (!writer) {
    return Response.json({ error: "unauthorized" }, { status: 401 })
  }
  let body: Record<string, unknown>
  try {
    body = (await context.request.json()) as Record<string, unknown>
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 })
  }
  const filed = await fileMarketplaceIssue(
    context.env.DB,
    {
      githubToken: context.env.GITHUB_TOKEN,
      openBotRepo: context.env.OPEN_BOT_REPO,
    },
    body,
  )
  if ("error" in filed) {
    return Response.json({ error: filed.error }, { status: filed.status })
  }
  return Response.json(
    { issue: filed.issue, duplicate: filed.duplicate },
    { status: filed.duplicate ? 200 : 201 },
  )
}
