import type { JoinedFile } from "./join-file"

export type QueuedMessage = {
  id: string
  text: string
  files: JoinedFile[]
}

export type EnqueueResult = {
  queue: QueuedMessage[]
  duplicate: boolean
}

export const MAX_QUEUED_MESSAGES = 10

/**
 * Appends to the waiting list. Null means the queue is full; `duplicate`
 * marks an identical message already waiting at the tail (a double Enter
 * must not send the same text twice).
 */
export function enqueueQueued(
  queue: QueuedMessage[],
  message: QueuedMessage,
): EnqueueResult | null {
  if (queue.length >= MAX_QUEUED_MESSAGES) return null
  const last = queue[queue.length - 1]
  if (
    last &&
    last.text.trim() === message.text.trim() &&
    last.files.length === 0 &&
    message.files.length === 0
  ) {
    return { queue, duplicate: true }
  }
  return { queue: [...queue, message], duplicate: false }
}

export function canQueueMore(queue: QueuedMessage[]): boolean {
  return queue.length < MAX_QUEUED_MESSAGES
}

export function dropQueuedHead(queue: QueuedMessage[]): QueuedMessage[] {
  return queue.slice(1)
}

/** Force-send moves the picked message ahead of everything still waiting. */
export function promoteQueued(
  queue: QueuedMessage[],
  id: string,
): QueuedMessage[] {
  const head = queue[0]
  if (!head || head.id === id) return queue
  const picked = queue.find((item) => item.id === id)
  if (!picked) return queue
  return [picked, ...queue.filter((item) => item.id !== id)]
}

export function removeQueuedItem(
  queue: QueuedMessage[],
  id: string,
): QueuedMessage[] {
  return queue.filter((item) => item.id !== id)
}
