import Alert from "@shpaw415/mui-lite/Alert"
import Box from "@shpaw415/mui-lite/Box"
import Button from "@shpaw415/mui-lite/Button"
import IconButton from "@shpaw415/mui-lite/IconButton"
import Paper from "@shpaw415/mui-lite/Paper"
import { CircularProgress } from "@shpaw415/mui-lite/Progress"
import Select from "@shpaw415/mui-lite/Select"
import Switch from "@shpaw415/mui-lite/Switch"
import TextField from "@shpaw415/mui-lite/TextField"
import Typography from "@shpaw415/mui-lite/Typography"
import { useCallback, useEffect, useId, useMemo, useState } from "react"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import AccessibleDialog, {
  DialogActions,
  DialogContent,
  DialogTitle,
} from "./AccessibleDialog"
import { api, type Me } from "./api"
import { PluginBadge } from "./ConfigList"
import { Chip } from "./chip"
import { formatFrAgo, formatFrWhen, type JobLike } from "./dashboard-data"
import { confirmDiscard, snapshotDirty } from "./discard-guard"
import { useDebounced, useEventStream, useMobile } from "./hooks"
import {
  AddIcon,
  ChatIcon,
  DeleteIcon,
  EditIcon,
  PlayArrowIcon,
  RefreshIcon,
  ScheduleIcon,
  SettingsIcon,
} from "./icons"
import { ModelSelect } from "./ModelSelect"
import type { PersonaInfo } from "./Personalities"
import Stack from "./stack"
import { Tip } from "./Tip"

export type CronJobInfo = JobLike & {
  message: string
  kind: "cron" | "every" | "at"
  cronExpr: string | null
  everySeconds: number | null
  atMs: number | null
  sessionId: string | null
  createdAt: number
  lastRunAt: number | null
  runCount: number
  providerId: string | null
  modelId: string | null
  personaId: string | null
  runKind?: "prompt" | "script" | "both" | "auto"
  script?: string | null
}

type CronNotice = {
  id: string
  jobId: string
  jobName: string
  summary: string | null
  createdAt: number
  viewedAt: number | null
}

/** Simple schedule picker values; cron stays available under Advanced. */
type ScheduleKind = "once" | "interval" | "cron"
type IntervalUnit = "minutes" | "hours" | "days"

type Model = { providerID: string; modelID: string; name?: string }

const MIN_EVERY_SECONDS = 60
const MAX_EVERY_SECONDS = 31_536_000

const UNIT_SECONDS: Record<IntervalUnit, number> = {
  minutes: 60,
  hours: 3600,
  days: 86_400,
}

/**
 * Bounded value+unit → everySeconds. 0 (or a value below one minute) is an
 * invalid state the caller reports; the cap matches the server contract.
 */
export function everySecondsFrom(
  value: string,
  unit: IntervalUnit,
): number | null {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  const seconds = Math.round(parsed * UNIT_SECONDS[unit])
  if (seconds < MIN_EVERY_SECONDS || seconds > MAX_EVERY_SECONDS) return null
  return seconds
}

/** Inverse: express seconds with the largest honest unit, or null. */
export function intervalFromSeconds(
  seconds: number | null | undefined,
): { value: string; unit: IntervalUnit } | null {
  if (!seconds || seconds <= 0) return null
  if (seconds % UNIT_SECONDS.days === 0)
    return { value: String(seconds / UNIT_SECONDS.days), unit: "days" }
  if (seconds % UNIT_SECONDS.hours === 0)
    return { value: String(seconds / UNIT_SECONDS.hours), unit: "hours" }
  if (seconds % UNIT_SECONDS.minutes === 0)
    return { value: String(seconds / UNIT_SECONDS.minutes), unit: "minutes" }
  // Not a whole minute: only the advanced seconds field can represent it.
  return null
}

/** "Tous les 2 jours" / "Toutes les heures" — real French, no "les 1". */
export function intervalLabel(seconds: number): string {
  const interval = intervalFromSeconds(seconds)
  if (!interval) return `Toutes les ${seconds} secondes`
  const n = Number(interval.value)
  if (interval.unit === "days")
    return n > 1 ? `Tous les ${n} jours` : "Tous les jours"
  const unit = interval.unit === "hours" ? "heures" : "minutes"
  return n > 1 ? `Toutes les ${n} ${unit}` : `Toutes les ${unit}`
}

function cronRunLabel(kind: CronJobInfo["runKind"]): string {
  if (kind === "script") return "script"
  if (kind === "both") return "script puis instruction"
  if (kind === "auto") return "script, agent si sollicité"
  return "instruction"
}

function cronModelValue(job: {
  providerId: string | null
  modelId: string | null
}): string {
  return job.providerId && job.modelId ? `${job.providerId}/${job.modelId}` : ""
}

function cronModelLabel(job: CronJobInfo, models: Model[]): string {
  if (!job.providerId || !job.modelId) return "modèle par défaut"
  const match = models.find(
    (item) =>
      item.providerID === job.providerId && item.modelID === job.modelId,
  )
  return match?.name ?? `${job.providerId}/${job.modelId}`
}

function cronDisplayName(job: CronJobInfo): string {
  return job.plugin ? job.name.replace(/^plugin:[^:]+:/, "") : job.name
}

/**
 * Human schedule summary. The engine runs cron in UTC and intervals as
 * durations — the label says exactly that, with the zone named for dates.
 */
export function cronScheduleLabel(job: CronJobInfo): string {
  if (job.kind === "cron")
    return `Expression cron (UTC) : ${job.cronExpr ?? ""}`
  if (job.kind === "every") return intervalLabel(job.everySeconds ?? 0)
  return `Une seule fois, le ${formatFrWhen(job.atMs)}`
}

/** Full, accessible date for the summary line. */
function formatFrFull(ts: number | null): string {
  if (!ts) return "—"
  return formatFrWhen(ts)
}

export function CronView({ me }: { me: Me }) {
  const mobile = useMobile()
  const { subscribe } = useEventStream(true)
  const [jobs, setJobs] = useState<CronJobInfo[]>([])
  const [notices, setNotices] = useState<CronNotice[]>([])
  const [loadError, setLoadError] = useState("")
  const [noticesError, setNoticesError] = useState("")
  const [busyId, setBusyId] = useState("")
  const [addOpen, setAddOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<CronJobInfo | null>(null)
  const addTitleId = useId()
  const deleteTitleId = useId()
  const resultTitleId = useId()
  const [name, setName] = useState("")
  const [message, setMessage] = useState("")
  const [kind, setKind] = useState<ScheduleKind>("interval")
  const [everyValue, setEveryValue] = useState("1")
  const [everyUnit, setEveryUnit] = useState<IntervalUnit>("hours")
  const [everySecondsRaw, setEverySecondsRaw] = useState("3600")
  const [expr, setExpr] = useState("0 9 * * *")
  const [at, setAt] = useState("")
  const [model, setModel] = useState("")
  const [persona, setPersona] = useState("assistant")
  const [runKind, setRunKind] = useState<"prompt" | "script" | "both" | "auto">(
    "prompt",
  )
  const [script, setScript] = useState("")
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [formError, setFormError] = useState("")
  const [editId, setEditId] = useState<string | null>(null)
  /** The job as it opened: closing asks before dropping real edits. */
  const [pristine, setPristine] = useState<Record<string, unknown> | null>(null)
  const [result, setResult] = useState<CronNotice | null>(null)
  const [error, setError] = useState("")
  const [models, setModels] = useState<Model[]>([])
  const [personas, setPersonas] = useState<PersonaInfo[]>([])

  const loadJobs = useCallback(async () => {
    try {
      const body = await api<CronJobInfo[]>("/api/cron")
      setJobs(Array.isArray(body) ? body : [])
      setLoadError("")
    } catch (caught) {
      // A failed load keeps the last good list and says so — never a fake
      // "no automations".
      setLoadError(
        caught instanceof Error ? caught.message : "chargement impossible",
      )
    }
  }, [])

  const loadNotices = useCallback(async () => {
    try {
      const body = await api<CronNotice[]>("/api/cron/notices")
      setNotices(Array.isArray(body) ? body : [])
      setNoticesError("")
    } catch (caught) {
      setNoticesError(
        caught instanceof Error ? caught.message : "chargement impossible",
      )
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

  function cronFormState(job?: CronJobInfo): Record<string, unknown> {
    return {
      name: job?.name ?? "",
      message: job?.message ?? "",
      kind: job
        ? job.kind === "at"
          ? ("once" as ScheduleKind)
          : job.kind === "cron"
            ? ("cron" as ScheduleKind)
            : ("interval" as ScheduleKind)
        : ("interval" as ScheduleKind),
      everyValue: intervalFromSeconds(job?.everySeconds)?.value ?? "1",
      everyUnit:
        intervalFromSeconds(job?.everySeconds)?.unit ??
        ("hours" as IntervalUnit),
      everySecondsRaw:
        job?.everySeconds != null && !intervalFromSeconds(job.everySeconds)
          ? String(job.everySeconds)
          : "3600",
      expr: job?.cronExpr ?? "0 9 * * *",
      at: "",
      model: job ? cronModelValue(job) : "",
      persona: job?.personaId || "assistant",
      runKind: job?.runKind ?? "prompt",
      script: job?.script ?? "",
    }
  }

  function openForm(job?: CronJobInfo) {
    const next = cronFormState(job)
    setEditId(job?.id ?? null)
    setName(next.name as string)
    setMessage(next.message as string)
    setKind(next.kind as ScheduleKind)
    setEveryValue(next.everyValue as string)
    setEveryUnit(next.everyUnit as IntervalUnit)
    setEverySecondsRaw(next.everySecondsRaw as string)
    setExpr(next.expr as string)
    setAt("")
    setModel(next.model as string)
    setPersona(next.persona as string)
    setRunKind(next.runKind as "prompt" | "script" | "both" | "auto")
    setScript(next.script as string)
    // Advanced jobs (scripts, cron) open with the technical controls
    // visible so their real values are editable, never converted away.
    const isAdvanced =
      job &&
      (job.kind === "cron" ||
        (job.runKind && job.runKind !== "prompt") ||
        !intervalFromSeconds(job.everySeconds))
    setAdvancedOpen(Boolean(isAdvanced))
    setFormError("")
    setPristine(next)
    setAddOpen(true)
  }

  /** Escape, backdrop and Cancel share this: real edits ask first. */
  function requestCloseForm() {
    if (saving) return
    const current: Record<string, unknown> = {
      name,
      message,
      kind,
      everyValue,
      everyUnit,
      everySecondsRaw,
      expr,
      at,
      model,
      persona,
      runKind,
      script,
    }
    if (snapshotDirty(pristine, current) && !confirmDiscard()) return
    setPristine(null)
    setAddOpen(false)
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

  /** Interval form state → wire seconds; null = invalid (caller reports). */
  function currentEverySeconds(): number | null {
    const picked = everySecondsFrom(everyValue, everyUnit)
    if (picked) return picked
    // A job whose exact seconds are not a whole minute keeps them unless
    // the picker itself holds a valid value (the raw field is visible in
    // the advanced options).
    const raw = Number(everySecondsRaw)
    if (
      Number.isFinite(raw) &&
      raw >= MIN_EVERY_SECONDS &&
      raw <= MAX_EVERY_SECONDS &&
      !everySecondsFrom(everyValue, everyUnit)
    )
      return raw
    return null
  }

  /** Honest one-line summary of what will be saved. */
  const scheduleSummary = useMemo(() => {
    if (kind === "once") {
      if (!at) return "Choisissez une date et une heure."
      const ts = new Date(at).getTime()
      if (!Number.isFinite(ts)) return "Date invalide."
      if (ts <= Date.now()) return "La date choisie est dans le passé."
      return `Une seule exécution, le ${formatFrFull(ts)} (heure de votre environnement).`
    }
    if (kind === "interval") {
      const picked = everySecondsFrom(everyValue, everyUnit)
      const raw = Number(everySecondsRaw)
      const seconds =
        picked ??
        (Number.isFinite(raw) &&
        raw >= MIN_EVERY_SECONDS &&
        raw <= MAX_EVERY_SECONDS
          ? raw
          : null)
      if (!seconds) return "Intervalle invalide — entre 1 minute et 1 an."
      return `${intervalLabel(seconds)} — l’intervalle est une durée; il ne suit pas une heure fixe locale.`
    }
    if (expr.trim().split(/\s+/).length !== 5)
      return "L’expression cron doit compter 5 champs."
    return `Expression cron (UTC) : ${expr.trim()} — « 0 9 * * * » signifie 9 h UTC, pas 9 h locale.`
  }, [kind, at, everyValue, everyUnit, everySecondsRaw, expr])

  async function saveJob() {
    if (saving) return
    setFormError("")
    const split = model.indexOf("/")
    const providerID = split > 0 ? model.slice(0, split) : null
    const modelID = split > 0 ? model.slice(split + 1) : null

    // Schedule validation happens near the field, before the request.
    let schedule: Record<string, unknown>
    if (kind === "once") {
      const ts = new Date(at).getTime()
      if (!at || !Number.isFinite(ts)) {
        setFormError("Choisissez une date et une heure valides.")
        return
      }
      if (ts <= Date.now()) {
        setFormError("La date choisie est dans le passé.")
        return
      }
      schedule = { kind: "at", atMs: ts }
    } else if (kind === "interval") {
      const seconds = currentEverySeconds()
      if (!seconds) {
        setFormError("L’intervalle doit être entre 1 minute et 1 an.")
        return
      }
      schedule = { kind: "every", everySeconds: seconds }
    } else {
      if (expr.trim().split(/\s+/).length !== 5) {
        setFormError("L’expression cron doit compter 5 champs.")
        return
      }
      schedule = { kind: "cron", cronExpr: expr.trim() }
    }

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
        // The PATCH contract accepts schedule changes — editing never asks
        // to recreate the job, and the server recomputes the next run.
        await api(`/api/cron/${editId}`, {
          method: "PATCH",
          body: JSON.stringify({ ...fields, ...schedule }),
        })
      } else {
        await api("/api/cron", {
          method: "POST",
          body: JSON.stringify({ ...fields, ...schedule }),
        })
      }
      setPristine(null)
      setAddOpen(false)
      await loadJobs()
    } catch (caught) {
      setFormError(
        caught instanceof Error
          ? caught.message
          : editId
            ? "échec de la modification"
            : "échec de la création",
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
      setError(caught instanceof Error ? caught.message : "échec")
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
      setError(caught instanceof Error ? caught.message : "échec")
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
      setError(caught instanceof Error ? caught.message : "échec")
    } finally {
      setBusyId("")
    }
  }

  return (
    <>
      <Stack spacing={1.5}>
        {error ? <Alert severity="error">{error}</Alert> : null}
        {loadError ? (
          <Alert severity="error">
            <Typography variant="body2">
              Impossible de charger les automatisations : {loadError}
            </Typography>
            <Button size="small" onClick={() => void loadJobs()}>
              Réessayer
            </Button>
          </Alert>
        ) : null}
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="caption" color="textSecondary" sx={{ flex: 1 }}>
            Une instruction fait travailler l’assistant. Un script exécute une
            commande; « script puis instruction » donne son résultat à
            l’assistant.
          </Typography>
          <Button
            size="small"
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => openForm()}
          >
            Nouvelle automatisation
          </Button>
          <Tip title="Recharger les automatisations">
            <IconButton
              size="small"
              aria-label="Recharger les automatisations"
              onClick={() => void loadJobs()}
            >
              <RefreshIcon />
            </IconButton>
          </Tip>
        </Stack>
        <Box className="ob-cron-list">
          {jobs.length === 0 && !loadError ? (
            <Stack
              alignItems="center"
              justifyContent="center"
              sx={{ minHeight: 160, textAlign: "center" }}
              spacing={1}
            >
              <ScheduleIcon width={40} height={40} style={{ opacity: 0.5 }} />
              <Typography variant="subtitle1">Aucune automatisation</Typography>
              <Typography variant="body2" color="textSecondary">
                Créez-en une avec le bouton ci-dessus, ou demandez à l’assistant
                de programmer une tâche récurrente.
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
                      aria-label={
                        job.enabled
                          ? `Mettre en pause ${job.name}`
                          : `Réactiver ${job.name}`
                      }
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
                      nouveau résultat
                    </Chip>
                  ) : null}
                  <Chip size="small" variant="outlined">
                    {cronScheduleLabel(job)}
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
                    ? `Prochaine exécution ${formatFrWhen(job.nextRunAt)}`
                    : "En pause — ne s’exécute pas"}{" "}
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
                      ? "échec"
                      : job.lastRunAt
                        ? `exécutée ${formatFrAgo(job.lastRunAt)}`
                        : "jamais exécutée"}
                  </Chip>
                  <Box sx={{ flex: 1 }} />
                  <Button
                    size="small"
                    variant="text"
                    startIcon={<EditIcon />}
                    disabled={Boolean(busyId)}
                    onClick={() => openForm(job)}
                  >
                    Modifier
                  </Button>
                  <Tip title="Exécute une fois maintenant, sans changer l’horaire.">
                    <Button
                      size="small"
                      variant="text"
                      startIcon={<PlayArrowIcon />}
                      disabled={Boolean(busyId)}
                      onClick={() => void runJob(job)}
                    >
                      Exécuter
                    </Button>
                  </Tip>
                  {notices.some((notice) => notice.jobId === job.id) ? (
                    <Button
                      size="small"
                      variant="text"
                      startIcon={<ChatIcon />}
                      disabled={Boolean(busyId)}
                      onClick={() => openJobResult(job)}
                    >
                      Résultat
                    </Button>
                  ) : null}
                  <IconButton
                    size="small"
                    aria-label={`Supprimer ${job.name}`}
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
        {noticesError ? (
          <Typography variant="caption" color="textSecondary">
            Résultats indisponibles : {noticesError}
          </Typography>
        ) : null}
      </Stack>

      {addOpen ? (
        <AccessibleDialog
          open
          onClose={requestCloseForm}
          aria-labelledby={addTitleId}
        >
          <DialogTitle id={addTitleId}>
            {editId ? "Modifier l’automatisation" : "Nouvelle automatisation"}
          </DialogTitle>
          <DialogContent>
            <Stack spacing={1.5} sx={{ mt: 1, minWidth: mobile ? 260 : 380 }}>
              <TextField
                label="Nom"
                value={name}
                autoFocus
                onChange={(event) => setName(event.currentTarget.value)}
              />
              {runKind !== "script" ? (
                <TextField
                  label="Que doit faire Open-bot?"
                  value={message}
                  multiline
                  rows={3}
                  onChange={(event) => setMessage(event.currentTarget.value)}
                />
              ) : null}
              <Select
                name="schedule-kind"
                label="Quand?"
                value={kind}
                onSelect={(value) => setKind(value as ScheduleKind)}
              >
                <option value="interval">À intervalle régulier</option>
                <option value="once">Une seule fois</option>
                <option value="cron">Expression avancée (cron, UTC)</option>
              </Select>
              {kind === "interval" ? (
                <Stack direction="row" spacing={1}>
                  <TextField
                    label="Toutes les"
                    value={everyValue}
                    inputMode="numeric"
                    onChange={(event) =>
                      setEveryValue(event.currentTarget.value)
                    }
                    sx={{ flex: 1 }}
                  />
                  <Select
                    name="every-unit"
                    label="Unité"
                    value={everyUnit}
                    onSelect={(value) => setEveryUnit(value as IntervalUnit)}
                    sx={{ flex: 1 }}
                  >
                    <option value="minutes">minutes</option>
                    <option value="hours">heures</option>
                    <option value="days">jours</option>
                  </Select>
                </Stack>
              ) : kind === "once" ? (
                <TextField
                  label="Date et heure"
                  value={at}
                  type="datetime-local"
                  onChange={(event) => setAt(event.currentTarget.value)}
                  helpText={`Fuseau de votre environnement : ${
                    Intl.DateTimeFormat().resolvedOptions().timeZone ?? "local"
                  }`}
                />
              ) : (
                <TextField
                  label="Expression cron (UTC)"
                  value={expr}
                  placeholder="0 9 * * 1-5"
                  onChange={(event) => setExpr(event.currentTarget.value)}
                  helpText="5 champs : minute, heure, jour du mois, mois, jour de semaine — en UTC."
                />
              )}
              <Typography variant="caption" color="textSecondary">
                {scheduleSummary}
              </Typography>
              <Button
                size="small"
                variant="text"
                startIcon={<SettingsIcon width={16} height={16} />}
                onClick={() => setAdvancedOpen((current) => !current)}
                sx={{ alignSelf: "flex-start" }}
                aria-expanded={advancedOpen}
              >
                {advancedOpen
                  ? "Masquer les options avancées"
                  : "Options avancées"}
              </Button>
              {advancedOpen ? (
                <Stack spacing={1.5}>
                  {kind === "interval" ? (
                    <TextField
                      label="Secondes exactes (contrat serveur)"
                      value={everySecondsRaw}
                      inputMode="numeric"
                      disabled={kind !== "interval"}
                      onChange={(event) =>
                        setEverySecondsRaw(event.currentTarget.value)
                      }
                      helpText="Utilisé tel quel s’il n’est pas un multiple d’une minute."
                    />
                  ) : null}
                  <Select
                    name="run"
                    label="Exécution"
                    value={runKind}
                    onSelect={(value) =>
                      setRunKind(value as "prompt" | "script" | "both" | "auto")
                    }
                  >
                    <option value="prompt">Instruction (assistant)</option>
                    <option value="script">Script</option>
                    <option value="both">Script puis instruction</option>
                    <option value="auto">Script, agent si sollicité</option>
                  </Select>
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
                      Le script s’exécute d’abord; l’agent ne se réveille que si
                      une ligne de sa sortie commence par [cron-agent]. Les
                      exécutions silencieuses ne publient rien.
                    </Typography>
                  ) : null}
                  {runKind !== "script" ? (
                    <ModelSelect
                      name="cron-model"
                      label="Modèle"
                      models={models}
                      value={model}
                      disabled={models.length === 0 && !model}
                      userId={me.id}
                      leading={{ id: "", title: "Modèle par défaut" }}
                      onSelect={setModel}
                    />
                  ) : null}
                  {runKind !== "script" ? (
                    <Select
                      name="cron-persona"
                      label="Assistant personnalisé"
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
                      ? "S’exécute sur le bureau dans /home/agent/workspace. La sortie est publiée dans le fil de cette automatisation."
                      : runKind === "both"
                        ? "Le script s’exécute d’abord; sa sortie est ajoutée à l’instruction, et le résultat de l’agent est publié dans le fil."
                        : "Le modèle et l’assistant personnalisé exécutent une session temporaire; le résultat est publié dans le fil."}
                    {runKind !== "script" && models.length === 0
                      ? " Démarrez le bureau pour choisir un modèle autre que celui par défaut."
                      : ""}
                  </Typography>
                </Stack>
              ) : null}
              {formError ? (
                <Typography variant="caption" color="error" role="alert">
                  {formError}
                </Typography>
              ) : null}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button variant="text" onClick={requestCloseForm}>
              Annuler
            </Button>
            <Button
              variant="contained"
              disabled={
                saving ||
                !name.trim() ||
                (runKind !== "script" && !message.trim()) ||
                (runKind !== "prompt" && !script.trim())
              }
              onClick={() => void saveJob()}
            >
              {saving ? "…" : editId ? "Enregistrer" : "Créer"}
            </Button>
          </DialogActions>
        </AccessibleDialog>
      ) : null}

      {deleteTarget ? (
        <AccessibleDialog
          open
          onClose={() => setDeleteTarget(null)}
          aria-labelledby={deleteTitleId}
        >
          <DialogTitle id={deleteTitleId}>
            Supprimer cette automatisation?
          </DialogTitle>
          <DialogContent>
            <Typography variant="body2">
              Supprime « {deleteTarget?.name ?? ""} » et ses résultats passés.
              Elle ne s’exécutera plus jamais. Cette action est irréversible.
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button variant="text" onClick={() => setDeleteTarget(null)}>
              Annuler
            </Button>
            <Button
              color="error"
              variant="contained"
              disabled={Boolean(busyId)}
              startIcon={<DeleteIcon />}
              onClick={() => void removeJob()}
            >
              Supprimer
            </Button>
          </DialogActions>
        </AccessibleDialog>
      ) : null}

      {result ? (
        <AccessibleDialog
          open
          onClose={() => setResult(null)}
          aria-labelledby={resultTitleId}
        >
          <DialogTitle id={resultTitleId}>
            {result.jobName ?? "Résultat de la dernière exécution"}
          </DialogTitle>
          <DialogContent>
            {result.summary?.trim() ? (
              <div className="ob-md">
                <Markdown remarkPlugins={[remarkGfm]}>
                  {result.summary}
                </Markdown>
              </div>
            ) : (
              <Typography variant="body2" color="textSecondary">
                Aucune sortie.
              </Typography>
            )}
          </DialogContent>
          <DialogActions>
            <Button variant="text" onClick={() => setResult(null)}>
              Fermer
            </Button>
          </DialogActions>
        </AccessibleDialog>
      ) : null}
    </>
  )
}
