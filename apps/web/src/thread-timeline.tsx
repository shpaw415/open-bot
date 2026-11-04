import Button from "@shpaw415/mui-lite/Button"
import IconButton from "@shpaw415/mui-lite/IconButton"
import TextField from "@shpaw415/mui-lite/TextField"
import { useState } from "react"
import {
  BoltIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CloseIcon,
  EditIcon,
} from "./icons"
import { THREADS_UI } from "./texts"
import { formatWorkDuration, type TurnWork } from "./timeline"

// Presentational rows of the derived thread timeline (see timeline.ts):
// the per-turn work summary line and the persisted queue dock that sits
// at the end of the log, above the composer, T3-style — dashed and
// unfilled so a not-yet-sent message never reads as a sent one.

export type ThreadQueueFileView = {
  id: string
  name: string
  mime: string
  url: string
}

export type ThreadQueueItemView = {
  id: string
  sessionId: string
  text: string
  files: ThreadQueueFileView[]
  createdAt: number
}

export function WorkLine({ work }: { work: TurnWork }) {
  const [open, setOpen] = useState(false)
  const label = work.running
    ? THREADS_UI.workingSteps(work.steps.length)
    : THREADS_UI.workedFor(
        formatWorkDuration(work.durationMs),
        work.steps.length,
      )
  return (
    <div className="ob-work">
      <button
        type="button"
        className="ob-work-head"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? (
          <ChevronDownIcon width={14} height={14} />
        ) : (
          <ChevronRightIcon width={14} height={14} />
        )}
        <span className={work.running ? "ob-work-dot" : undefined} />
        <span>{label}</span>
      </button>
      {open ? (
        <ol className="ob-work-steps">
          {work.steps.map((step, index) => (
            <li key={`${index}-${step.tool}-${step.title}`}>
              <span className="ob-work-tool">{step.tool}</span>
              <span className="ob-work-title">{step.title}</span>
              {step.status && step.status !== "completed" ? (
                <span className="ob-work-status">{step.status}</span>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  )
}

const QUEUE_VISIBLE_ROWS = 3

export function QueueDock({
  items,
  busyId,
  onSendNow,
  onRemove,
  onSaveEdit,
}: {
  items: ThreadQueueItemView[]
  busyId: string
  onSendNow: (id: string) => void
  onRemove: (id: string) => void
  onSaveEdit: (
    item: ThreadQueueItemView,
    text: string,
    files: ThreadQueueFileView[],
  ) => Promise<boolean>
}) {
  const [showAll, setShowAll] = useState(false)
  const [editingId, setEditingId] = useState("")
  const [editText, setEditText] = useState("")
  const [editFiles, setEditFiles] = useState<ThreadQueueFileView[]>([])
  if (items.length === 0) return null
  const collapsible = items.length > QUEUE_VISIBLE_ROWS
  const visible =
    collapsible && !showAll ? items.slice(0, QUEUE_VISIBLE_ROWS - 1) : items

  const startEdit = (item: ThreadQueueItemView) => {
    setEditingId(item.id)
    setEditText(item.text)
    setEditFiles(item.files)
    setShowAll(true)
  }
  const cancelEdit = () => {
    setEditingId("")
    setEditText("")
    setEditFiles([])
  }
  const saveEdit = async (item: ThreadQueueItemView) => {
    if (await onSaveEdit(item, editText, editFiles)) cancelEdit()
  }

  return (
    <section
      className="ob-queue"
      aria-label={THREADS_UI.queuedSection(items.length)}
    >
      <ol className="ob-queue-list">
        {visible.map((item, position) => {
          const editing = editingId === item.id
          return (
            <li
              key={item.id}
              className="ob-queue-item"
              aria-label={`${THREADS_UI.queued} ${position + 1}/${items.length}`}
            >
              <div
                className={`ob-queue-card${editing ? " ob-queue-card-editing" : ""}`}
              >
                {editing ? (
                  <>
                    <TextField
                      multiline
                      value={editText}
                      sx={{ width: "100%" }}
                      aria-label={THREADS_UI.editQueued}
                      onChange={(event) =>
                        setEditText(event.currentTarget.value)
                      }
                    />
                    {editFiles.length > 0 ? (
                      <span className="ob-queue-files">
                        {editFiles.map((file) => (
                          <span key={file.id} className="ob-queue-file">
                            {file.name}
                            <IconButton
                              size="small"
                              aria-label={file.name}
                              onClick={() =>
                                setEditFiles((prev) =>
                                  prev.filter((row) => row.id !== file.id),
                                )
                              }
                            >
                              <CloseIcon width={12} height={12} />
                            </IconButton>
                          </span>
                        ))}
                      </span>
                    ) : null}
                  </>
                ) : (
                  <>
                    {item.files.length > 0 ? (
                      <span className="ob-queue-files">
                        {item.files.map((file) =>
                          file.mime.startsWith("image/") &&
                          file.url.startsWith("data:image/") ? (
                            <img
                              key={file.id}
                              className="ob-queue-thumb"
                              src={file.url}
                              alt={file.name}
                            />
                          ) : (
                            <span key={file.id} className="ob-queue-file">
                              {file.name}
                            </span>
                          ),
                        )}
                      </span>
                    ) : null}
                    {item.text.trim() ? (
                      <p className="ob-queue-text">{item.text}</p>
                    ) : null}
                  </>
                )}
              </div>
              <div className="ob-queue-actions">
                {editing ? (
                  <>
                    <Button
                      size="small"
                      variant="text"
                      disabled={
                        busyId !== "" ||
                        (!editText.trim() && editFiles.length === 0)
                      }
                      onClick={() => void saveEdit(item)}
                    >
                      {THREADS_UI.saveQueuedEdit}
                    </Button>
                    <Button size="small" variant="text" onClick={cancelEdit}>
                      {THREADS_UI.cancelEdit}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      size="small"
                      variant="text"
                      title={THREADS_UI.forceSend}
                      disabled={busyId !== ""}
                      onClick={() => onSendNow(item.id)}
                      startIcon={<BoltIcon width={14} height={14} />}
                    >
                      {THREADS_UI.sendNow}
                    </Button>
                    <IconButton
                      size="small"
                      title={THREADS_UI.editQueued}
                      aria-label={THREADS_UI.editQueued}
                      disabled={busyId !== ""}
                      onClick={() => startEdit(item)}
                    >
                      <EditIcon width={15} height={15} />
                    </IconButton>
                    <IconButton
                      size="small"
                      title={THREADS_UI.removeQueued}
                      aria-label={THREADS_UI.removeQueued}
                      disabled={busyId !== ""}
                      onClick={() => onRemove(item.id)}
                    >
                      <CloseIcon width={15} height={15} />
                    </IconButton>
                  </>
                )}
              </div>
            </li>
          )
        })}
      </ol>
      {collapsible ? (
        <div className="ob-queue-more">
          <Button
            size="small"
            variant="text"
            aria-expanded={showAll}
            onClick={() => setShowAll((value) => !value)}
            endIcon={
              <ChevronDownIcon
                width={14}
                height={14}
                className={showAll ? "ob-queue-chevron-up" : undefined}
              />
            }
          >
            {showAll
              ? THREADS_UI.queuedShowFewer
              : THREADS_UI.queuedShowAll(items.length)}
          </Button>
        </div>
      ) : null}
    </section>
  )
}
