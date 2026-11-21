import { ApiHttpError } from "./api"

// The queue dock mirrors server state (GET /api/thread-queue/:sessionId)
// and refreshes on queue.changed — but a phone with its screen off
// misses those events while the control plane flushes (sends) the
// queued messages, so the dock can keep showing ghost rows for items
// that already left the queue. A remove/send/edit on such a row comes
// back 404 (code queue_item_gone on current servers, a bare message on
// older ones the dashboard may deploy ahead of). That is not a user
// error: the item is gone, which for remove is exactly the goal — the
// dock just needs to resync, silently.
export function isQueueItemGone(caught: unknown): boolean {
  return caught instanceof ApiHttpError && caught.status === 404
}

/** The dock without one item, order preserved; unknown ids change nothing. */
export function dropQueueItem<T extends { id: string }>(
  items: readonly T[],
  id: string,
): T[] {
  return items.filter((item) => item.id !== id)
}
