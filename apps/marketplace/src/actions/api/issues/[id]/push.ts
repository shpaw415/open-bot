"no action"

import { adminAuthorized } from "../../../../lib/auth"
import {
  issuesSchemaSelfCheck,
  pushIssueToGithub,
} from "../../../../lib/issues"

// Admin retry of a failed (or never-attempted) GitHub push. Already-pushed
// issues answer `alreadyPushed: true`; a push that fails again answers 502
// with the issue, whose pushError names the failure.

export async function onRequestPost(context: EventContext<Env, "id", never>) {
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
  const id = decodeURIComponent(context.params.id as string)
  const pushed = await pushIssueToGithub(
    context.env.DB,
    {
      githubToken: context.env.GITHUB_TOKEN,
      openBotRepo: context.env.OPEN_BOT_REPO,
    },
    id,
  )
  if ("error" in pushed) {
    return Response.json({ error: pushed.error }, { status: pushed.status })
  }
  if (!pushed.issue.githubUrl) {
    return Response.json(
      {
        error: pushed.issue.pushError ?? "GitHub push failed",
        issue: pushed.issue,
      },
      { status: 502 },
    )
  }
  return Response.json({
    issue: pushed.issue,
    alreadyPushed: pushed.alreadyPushed ?? false,
  })
}
