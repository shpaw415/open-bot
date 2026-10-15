import Alert from "@shpaw415/mui-lite/Alert"
import Box from "@shpaw415/mui-lite/Box"
import Button from "@shpaw415/mui-lite/Button"
import Chip from "@shpaw415/mui-lite/Chip"
import Dialog, {
  DialogActions,
  DialogContent,
  DialogTitle,
} from "@shpaw415/mui-lite/Dialog"
import IconButton from "@shpaw415/mui-lite/IconButton"
import Paper from "@shpaw415/mui-lite/Paper"
import { CircularProgress } from "@shpaw415/mui-lite/Progress"
import Select from "@shpaw415/mui-lite/Select"
import Stack from "@shpaw415/mui-lite/Stack"
import Switch from "@shpaw415/mui-lite/Switch"
import TextField from "@shpaw415/mui-lite/TextField"
import ToolTip from "@shpaw415/mui-lite/ToolTip"
import Typography from "@shpaw415/mui-lite/Typography"
import { useCallback, useEffect, useState } from "react"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { api, type Me } from "./api"
import { PluginBadge } from "./ConfigList"
import { useDebounced, useEventStream, useMobile } from "./hooks"
import {
  AddIcon,
  ChatIcon,
  DeleteIcon,
  EditIcon,
  PlayArrowIcon,
  RefreshIcon,
  ScheduleIcon,
} from "./icons"
import { ModelSelect } from "./ModelSelect"
import type { PersonaInfo } from "./Personalities"

export type CronJobInfo = {
  id: string
  name: string
  message: string
  kind: "cron" | "every" | "at"
  cronExpr: string | null
  everySeconds: number | null
  atMs: number | null
  enabled: boolean
  sessionId: string | null
  createdAt: number
  lastRunAt: number | null
  nextRunAt: number | null
  runCount: number
  lastError: string | null
  providerId: string | null
  modelId: string | null
  personaId: string | null
  runKind?: "prompt" | "script" | "both" | "auto"
  script?: string | null
  plugin?: { id: string; name: string }
}

type CronNotice = {
  id: string
  jobId: string
  jobName: string
  summary: string | null
  createdAt: number
  viewedAt: number | null
}

type CronKind = "every" | "cron" | "at"

type Model = { providerID: string; modelID: string; name?: string }

function formatAgo(ts: number): string {
  if (!ts) return ""
  const minutes = Math.round((Date.now() - ts) / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

function formatWhen(ts: number | null): string {
  if (!ts) return "—"
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function cronRunLabel(kind: CronJobInfo["runKind"]): string {
  if (kind === "script") return "script"
  if (kind === "both") return "script + prompt"
  if (kind === "auto") return "script + agent if flagged"
  return "prompt"
}

function cronModelValue(job: {
  providerId: string | null
  modelId: string | null
}): string {
  return job.providerId && job.modelId ? `${job.providerId}/${job.modelId}` : ""
}

function cronModelLabel(job: CronJobInfo, models: Model[]): string {
  if (!job.providerId || !job.modelId) return "default model"
  const match = models.find(
    (item) =>
      item.providerID === job.providerId && item.modelID === job.modelId,
  )
  return match?.name ?? `${job.providerId}/${job.modelId}`
}

function editingSchedule(jobs: CronJobInfo[], id: string): string {
  const job = jobs.find((item) => item.id === id)
  return job ? cronSchedule(job) : "as created"
}

function cronDisplayName(job: CronJobInfo): string {
  return job.plugin ? job.name.replace(/^plugin:[^:]+:/, "") : job.name
}

function cronSchedule(job: CronJobInfo): string {
  if (job.kind === "cron") return job.cronExpr ?? ""
  if (job.kind === "every") {
    const seconds = job.everySeconds ?? 0
    if (seconds >= 86400 && seconds % 86400 === 0)
      return `every ${seconds / 86400}d`
    if (seconds >= 3600 && seconds % 3600 === 0)
      return `every ${seconds / 3600}h`
    if (seconds >= 60 && seconds % 60 === 0) return `every ${seconds / 60}m`
    return `every ${seconds}s`
  }
  return `once at ${formatWhen(job.atMs)}`
}

export function CronView({ me }: { me: Me }) {
  const mobile = useMobile()
  const { subscribe } = useEventStream(true)
  const [jobs, setJobs] = useState<CronJobInfo[]>([])
  const [notices, setNotices] = useState<CronNotice[]>([])
  const [busyId, setBusyId] = useState("")
  const [addOpen, setAddOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<CronJobInfo | null>(null)
  const [name, setName] = useState("")
  const [message, setMessage] = useState("")
  const [kind, setKind] = useState<CronKind>("every")
  const [every, setEvery] = useState("3600")
  const [expr, setExpr] = useState("0 9 * * *")
  const [at, setAt] = useState("")
  const [model, setModel] = useState("")
  const [persona, setPersona] = useState("assistant")
  const [runKind, setRunKind] = useState<"prompt" | "script" | "both" | "auto">(
    "prompt",
  )
  const [script, setScript] = useState("")
  const [editId, setEditId] = useState<string | null>(null)
  const [result, setResult] = useState<CronNotice | null>(null)
  const [error, setError] = useState("")
  const [models, setModels] = useState<Model[]>([])
  const [personas, setPersonas] = useState<PersonaInfo[]>([])

  const loadJobs = useCallback(async () => {
    try {
      const body = await api<CronJobInfo[]>("/api/cron")
      setJobs(Array.isArray(body) ? body : [])
    } catch {
      // transient — the next poll retries
    }
  }, [])

  const loadNotices = useCallback(async () => {
    try {
      const body = await api<CronNotice[]>("/api/cron/notices")
      setNotices(Array.isArray(body) ? body : [])
    } catch {
      return
    }
  }, [])

  const scheduleJobs = useDebounced(() => void loadJobs(), 300)
  const scheduleNotices = useDebounced(() => void loadNotices(), 300)

  useEffect(() => {
    void loadJobs()
    void loadNotices()
    void api<{ models?: Model[]; connected?: string[] }>("/api/models")
      .then((body) =>
        setModels(
          (body.models ?? []).filter((item) => item.providerID && item.modelID),
        ),
      )
      .catch(() => {})
    void api<{ personas?: PersonaInfo[] }>("/api/personas")
      .then((body) => setPersonas(body.personas ?? []))
      .catch(() => {})
  }, [loadJobs, loadNotices])

  useEffect(() => {
    return subscribe((event) => {
      if (event.type === "cron.changed") scheduleJobs()
      if (event.type === "cron.notices") scheduleNotices()
    })
  }, [subscribe, scheduleJobs, scheduleNotices])

  function personaName(id: string | undefined): string {
    if (!id || id === "assistant") return "Assistant"
    return personas.find((item) => item.id === id)?.name ?? id
  }

  function openForm(job?: CronJobInfo) {
    setEditId(job?.id ?? null)
    setName(job?.name ?? "")
    setMessage(job?.message ?? "")
    setKind(job?.kind ?? "every")
    setEvery(String(job?.everySeconds ?? 3600))
    setExpr(job?.cronExpr ?? "0 9 * * *")
    setAt("")
    setModel(job ? cronModelValue(job) : "")
    setPersona(job?.personaId || "assistant")
    setRunKind(job?.runKind ?? "prompt")
    setScript(job?.script ?? "")
    setAddOpen(true)
  }

  function openNotice(notice: CronNotice) {
    setNotices((current) =>
      current.map((item) =>
        item.id === notice.id && !item.viewedAt
          ? { ...item, viewedAt: Date.now() }
          : item,
      ),
    )
    void api("/api/cron/notices/view", {
      method: "POST",
      body: JSON.stringify({ id: notice.id }),
    }).catch(() => void loadNotices())
    setResult(notice)
  }

  function openJobResult(job: CronJobInfo) {
    const notice = notices.find((item) => item.jobId === job.id)
    if (notice) openNotice(notice)
  }

  async function saveJob() {
    if (saving) return
    setError("")
    const split = model.indexOf("/")
    const providerID = split > 0 ? model.slice(0, split) : null
    const modelID = split > 0 ? model.slice(split + 1) : null
    const fields = {
      name: name.trim(),
      message: message.trim(),
      script: script.trim() || null,
      runKind,
      providerID,
      modelID,
      personaId: persona || "assistant",
    }
    setSaving(true)
    try {
      if (editId) {
        await api(`/api/cron/${editId}`, {
          method: "PATCH",
          body: JSON.stringify(fields),
        })
      } else {
        await api("/api/cron", {
          method: "POST",
          body: JSON.stringify({
            ...fields,
            kind,
            ...(kind === "every"
              ? { everySeconds: Number(every) }
              : kind === "cron"
                ? { cronExpr: expr.trim() }
                : { atMs: new Date(at).getTime() }),
          }),
        })
      }
      setAddOpen(false)
      await loadJobs()
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : editId
            ? "job update failed"
            : "job create failed",
      )
    } finally {
      setSaving(false)
    }
  }

  async function toggleJob(job: CronJobInfo) {
    if (busyId) return
    setBusyId(job.id)
    try {
      await api(`/api/cron/${job.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !job.enabled }),
      })
      await loadJobs()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "update failed")
    } finally {
      setBusyId("")
    }
  }

  async function runJob(job: CronJobInfo) {
    if (busyId) return
    setError("")
    setBusyId(job.id)
    try {
      await api(`/api/cron/${job.id}/run`, { method: "POST" })
      await loadJobs()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "run failed")
    } finally {
      setBusyId("")
    }
  }

  async function removeJob() {
    const target = deleteTarget
    if (!target || busyId) return
    setBusyId(target.id)
    try {
      await api(`/api/cron/${target.id}`, { method: "DELETE" })
      setDeleteTarget(null)
      await loadJobs()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "delete failed")
    } finally {
      setBusyId("")
    }
  }

  return (
    <>
      <Stack spacing={1.5}>
        {error ? <Alert severity="error">{error}</Alert> : null}
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="caption" color="textSecondary" sx={{ flex: 1 }}>
            Prompt runs the agent. Script posts command output. Script then
            prompt gives that output to the agent.
          </Typography>
          <Button
            size="small"
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => openForm()}
          >
            Add job
          </Button>
          <ToolTip title="Reload jobs">
            <IconButton
              size="small"
              aria-label="Reload jobs"
              onClick={() => void loadJobs()}
            >
              <RefreshIcon />
            </IconButton>
          </ToolTip>
        </Stack>
        <Box className="ob-cron-list">
          {jobs.length === 0 ? (
            <Stack
              alignItems="center"
              justifyContent="center"
              sx={{ minHeight: 160, textAlign: "center" }}
              spacing={1}
            >
              <ScheduleIcon width={40} height={40} style={{ opacity: 0.5 }} />
              <Typography variant="subtitle1">No scheduled jobs</Typography>
              <Typography variant="body2" color="textSecondary">
                Add one with the button above, or ask the agent to schedule
                work with ob-cron.
              </Typography>
            </Stack>
          ) : (
            jobs.map((job) => (
              <Paper key={job.id} variant="outlined" sx={{ p: 1.5 }}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography
                    variant="subtitle2"
                    sx={{
                      flex: 1,
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {cronDisplayName(job)}
                  </Typography>
                  {busyId === job.id ? (
                    <CircularProgress size={1.2} />
                  ) : (
                    <Switch
                      size="small"
                      checked={job.enabled}
                      aria-label={`Toggle ${job.name}`}
                      onChange={() => void toggleJob(job)}
                    />
                  )}
                </Stack>
                <Stack
                  direction="row"
                  spacing={0.75}
                  alignItems="center"
                  sx={{ mt: 0.75, flexWrap: "wrap", rowGap: 0.75 }}
                >
                  {job.plugin ? (
                    <PluginBadge plugin={job.plugin} maxWidth={120} />
                  ) : null}
                  {notices.some(
                    (notice) => notice.jobId === job.id && !notice.viewedAt,
                  ) ? (
                    <Chip size="small" color="primary">
                      new result
                    </Chip>
                  ) : null}
                  <Chip size="small" variant="outlined">
                    {cronSchedule(job)}
                  </Chip>
                  <Chip size="small" variant="outlined">
                    {cronRunLabel(job.runKind)}
                  </Chip>
                </Stack>
                <Typography
                  variant="body2"
                  color="textSecondary"
                  sx={{
                    mt: 0.5,
                    overflow: "hidden",
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                  }}
                >
                  {job.runKind === "script" || job.runKind === "auto"
                    ? job.script
                    : job.message}
                </Typography>
                <Typography
                  variant="caption"
                  color="textSecondary"
                  sx={{
                    mt: 0.5,
                    overflow: "hidden",
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                  }}
                >
                  {job.enabled
                    ? `Next run ${formatWhen(job.nextRunAt)}`
                    : "Paused"}{" "}
                  • {cronModelLabel(job, models)} •{" "}
                  {personaName(job.personaId ?? undefined)}
                </Typography>
                <Stack
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  sx={{
                    mt: 1,
                    flexWrap: "wrap",
                    rowGap: 1,
                    "@media (max-width:400px)": {
                      flexWrap: "nowrap",
                      overflowX: "auto",
                    },
                  }}
                >
                  <Chip
                    size="small"
                    variant="outlined"
                    color={
                      job.lastError
                        ? "error"
                        : job.lastRunAt
                          ? "success"
                          : undefined
                    }
                  >
                    {job.lastError
                      ? "error"
                      : job.lastRunAt
                        ? `ran ${formatAgo(job.lastRunAt)}`
                        : "never ran"}
                  </Chip>
                  <Box sx={{ flex: 1 }} />
                  <Button
                    size="small"
                    variant="text"
                    startIcon={<EditIcon />}
                    disabled={Boolean(busyId)}
                    onClick={() => openForm(job)}
                  >
                    Edit
                  </Button>
                  <Button
                    size="small"
                    variant="text"
                    startIcon={<PlayArrowIcon />}
                    disabled={Boolean(busyId)}
                    onClick={() => void runJob(job)}
                  >
                    Run now
                  </Button>
                  {notices.some((notice) => notice.jobId === job.id) ? (
                    <Button
                      size="small"
                      variant="text"
                      startIcon={<ChatIcon />}
                      disabled={Boolean(busyId)}
                      onClick={() => openJobResult(job)}
                    >
                      Result
                    </Button>
                  ) : null}
                  <IconButton
                    size="small"
                    aria-label={`Delete ${job.name}`}
                    disabled={Boolean(busyId)}
                    onClick={() => setDeleteTarget(job)}
                  >
                    <DeleteIcon width={18} height={18} />
                  </IconButton>
                </Stack>
                {job.lastError ? (
                  <Typography
                    variant="caption"
                    color="error"
                    sx={{ display: "block", mt: 0.5 }}
                  >
                    {job.lastError}
                  </Typography>
                ) : null}
              </Paper>
            ))
          )}
        </Box>
      </Stack>

      {addOpen ? (
        <Dialog open onClose={() => setAddOpen(false)}>
          <DialogTitle>{editId ? "Edit cron job" : "Add cron job"}</DialogTitle>
          <DialogContent>
            <Stack spacing={1.5} sx={{ mt: 1, minWidth: mobile ? 260 : 380 }}>
              <TextField
                label="Name"
                value={name}
                autoFocus
                onChange={(event) => setName(event.currentTarget.value)}
              />
              <Select
                name="run"
                label="Run as"
                value={runKind}
                onSelect={(value) =>
                  setRunKind(value as "prompt" | "script" | "both" | "auto")
                }
              >
                <option value="prompt">Prompt</option>
                <option value="script">Script</option>
                <option value="both">Script then prompt</option>
                <option value="auto">Script, agent only if flagged</option>
              </Select>
              {runKind !== "script" ? (
                <TextField
                  label="Message sent to the agent"
                  value={message}
                  multiline
                  rows={3}
                  onChange={(event) => setMessage(event.currentTarget.value)}
                />
              ) : null}
              {runKind !== "prompt" ? (
                <TextField
                  label="Script"
                  value={script}
                  multiline
                  rows={4}
                  placeholder="bash /home/agent/workspace/check.sh"
                  onChange={(event) => setScript(event.currentTarget.value)}
                />
              ) : null}
              {runKind === "auto" ? (
                <Typography variant="caption" color="textSecondary">
                  The script runs first; the agent wakes only when a line of its
                  output starts with [cron-agent]. Silent runs post nothing.
                </Typography>
              ) : null}
              {editId ? (
                <Typography variant="caption" color="textSecondary">
                  Schedule stays {editingSchedule(jobs, editId)}.
                </Typography>
              ) : (
                <>
                  <Select
                    name="schedule"
                    label="Schedule"
                    value={kind}
                    onSelect={(value) => setKind(value as CronKind)}
                  >
                    <option value="every">Interval</option>
                    <option value="cron">Cron expression (UTC)</option>
                    <option value="at">One time</option>
                  </Select>
                  {kind === "every" ? (
                    <TextField
                      label="Every (seconds, min 60)"
                      value={every}
                      inputMode="numeric"
                      onChange={(event) => setEvery(event.currentTarget.value)}
                    />
                  ) : kind === "cron" ? (
                    <TextField
                      label="Cron expression"
                      value={expr}
                      placeholder="0 9 * * 1-5"
                      onChange={(event) => setExpr(event.currentTarget.value)}
                    />
                  ) : (
                    <TextField
                      label="Run at"
                      value={at}
                      type="datetime-local"
                      onChange={(event) => setAt(event.currentTarget.value)}
                    />
                  )}
                </>
              )}
              {runKind !== "script" ? (
                <ModelSelect
                  name="cron-model"
                  label="Model"
                  models={models}
                  value={model}
                  disabled={models.length === 0 && !model}
                  userId={me.id}
                  leading={{ id: "", title: "Desktop default" }}
                  onSelect={setModel}
                />
              ) : null}
              {runKind !== "script" ? (
                <Select
                  name="cron-persona"
                  label="Personality"
                  value={persona}
                  onSelect={setPersona}
                >
                  {[
                    ...(personas.length
                      ? personas
                      : [
                          {
                            id: "assistant",
                            name: "Assistant",
                            instruction: "",
                            builtin: true,
                          },
                        ]
                    ).map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    )),
                    ...(persona &&
                    !personas.some((item) => item.id === persona) &&
                    persona !== "assistant"
                      ? [
                          <option key={persona} value={persona}>
                            {personaName(persona)}
                          </option>,
                        ]
                      : []),
                  ]}
                </Select>
              ) : null}
              <Typography variant="caption" color="textSecondary">
                {runKind === "script"
                  ? "Runs on the desktop in /home/agent/workspace. Output is posted to this job's thread."
                  : runKind === "both"
                    ? "The script runs first. Its output is added to the prompt. The agent's result is posted to this job's thread."
                    : "The model and personality run the temporary session. The result is still posted to this job's thread."}
                {runKind !== "script" && models.length === 0
                  ? " Start the desktop to choose a model other than the desktop default."
                  : ""}
              </Typography>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button variant="text" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="contained"
              disabled={
                saving ||
                !name.trim() ||
                (runKind !== "script" && !message.trim()) ||
                (runKind !== "prompt" && !script.trim()) ||
                (!editId &&
                  ((kind === "every" && !(Number(every) >= 60)) ||
                    (kind === "cron" &&
                      expr.trim().split(/\s+/).length !== 5) ||
                    (kind === "at" && !at)))
              }
              onClick={() => void saveJob()}
            >
              {saving ? "…" : editId ? "Save" : "Add"}
            </Button>
          </DialogActions>
        </Dialog>
      ) : null}

      {deleteTarget ? (
        <Dialog open onClose={() => setDeleteTarget(null)}>
          <DialogTitle>Delete cron job?</DialogTitle>
          <DialogContent>
            <Typography variant="body2">
              Deletes “{deleteTarget?.name ?? ""}” and its past results. It will
              never run again. This cannot be undone.
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button variant="text" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              color="error"
              variant="contained"
              disabled={Boolean(busyId)}
              startIcon={<DeleteIcon />}
              onClick={() => void removeJob()}
            >
              Delete
            </Button>
          </DialogActions>
        </Dialog>
      ) : null}

      {result ? (
        <Dialog open onClose={() => setResult(null)}>
          <DialogTitle>{result.jobName ?? ""}</DialogTitle>
          <DialogContent>
            {result.summary?.trim() ? (
              <div className="ob-md">
                <Markdown remarkPlugins={[remarkGfm]}>
                  {result.summary}
                </Markdown>
              </div>
            ) : (
              <Typography variant="body2" color="textSecondary">
                No output.
              </Typography>
            )}
          </DialogContent>
          <DialogActions>
            <Button variant="text" onClick={() => setResult(null)}>
              Close
            </Button>
          </DialogActions>
        </Dialog>
      ) : null}
    </>
  )
}
