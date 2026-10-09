import type { SecurityReviewMessage } from "../../../marketplace/src/lib/review-state"
import {
  failSecurityReview,
  processSecurityReview,
} from "../../../marketplace/src/lib/review-store"

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "security review failed"
}

export default {
  async queue(batch: MessageBatch<SecurityReviewMessage>, env: Env) {
    for (const message of batch.messages) {
      try {
        await processSecurityReview(env, message.body)
        message.ack()
      } catch (error) {
        console.error("security review consumer failed", error)
        if (message.attempts >= 3) {
          await failSecurityReview(env, message.body, errorText(error)).catch(
            (recordError: unknown) => {
              console.error("could not record review failure", recordError)
            },
          )
          message.ack()
        } else {
          message.retry()
        }
      }
    }
  },
}
