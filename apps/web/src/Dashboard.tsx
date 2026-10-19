import Box from "@shpaw415/mui-lite/Box"
import Button from "@shpaw415/mui-lite/Button"
import Chip from "@shpaw415/mui-lite/Chip"
import Paper from "@shpaw415/mui-lite/Paper"
import Typography from "@shpaw415/mui-lite/Typography"
import { useCallback, useEffect, useRef, useState } from "react"
import { api, type DesktopStatus, type Me, type QuotaState } from "./api"
import {
  buildAlerts,
  buildChecklist,
  checklistComplete,
  formatFrAgo,
  formatFrWhen,
  type HomeAlert,
  type JobLike,
  markNewThreadIntent,
  parseRecentThreads,
  pickUpcomingJobs,
  type RecentThread,
  setComposerSeed,
  type UpcomingJob,
} from "./dashboard-data"
import { useEventStream } from "./hooks"
import { ChatIcon, ExtensionIcon, FolderIcon } from "./icons"
import type { PluginTab } from "./plugin-tabs"
import { CHAT_PATH, HELP_PATH, pluginPath, workspacePath } from "./routes"
import Stack from "./stack"
import { DESKTOP_STATE_TEXT, NAV } from "./texts"

// One visible poll at a time; hidden tabs don't hold servers up.
function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(
    () => typeof document === "undefined" || !document.hidden,
  )
  useEffect(() => {
    const update = () => setVisible(!document.hidden)
    document.addEventListener("visibilitychange", update)
    return () => document.removeEventListener("visibilitychange", update)
  }, [])
  return visible
}

type Res<T> = {
  status: "loading" | "ready" | "error"
  data: T
  error: string
  at: number
}

function freshRes<T>(data: T): Res<T> {
  return { status: "loading", data, error: "", at: 0 }
}

const GUIDE_KEY = "ob-home-guide-hidden"

const EXAMPLES = [
  "Fais une recherche et résume-moi…",
  "Rédige un courriel de suivi pour…",
  "Prépare un plan pour…",
]

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <Typography
      variant="subtitle2"
      component="h2"
      sx={{ mb: 1, color: "textSecondary" }}
    >
      {children}
    </Typography>
  )
}

function SectionError({
  text,
  onRetry,
}: {
  text: string
  onRetry: () => void
}) {
  return (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Typography variant="body2" color="textSecondary">
        {text}
      </Typography>
      <Button size="small" variant="text" onClick={onRetry} sx={{ mt: 0.5 }}>
        Réessayer
      </Button>
    </Paper>
  )
}

export function Dashboard({
  me,
  tabs,
  go,
  onOpenThread,
}: {
  me: Me
  tabs: PluginTab[]
  go: (path: string) => void
  onOpenThread: (sessionId: string) => void
}) {
  const visible = useDocumentVisible()
  const { subscribe } = useEventStream(true)
  const [phase, setPhase] = useState<"starting" | "running" | "sleeping">(
    me.desktop ?? "sleeping",
  )
  const [startError, setStartError] = useState("")
  const [waking, setWaking] = useState(false)
  const [threads, setThreads] = useState<Res<RecentThread[]>>(freshRes([]))
  const [jobs, setJobs] = useState<Res<UpcomingJob[]>>(freshRes([]))
  const [quota, setQuota] = useState<Res<QuotaState | null>>(freshRes(null))
  const [projects, setProjects] = useState<Res<number>>(freshRes(0))
  const [guideHidden, setGuideHidden] = useState(() => {
    try {
      return localStorage.getItem(GUIDE_KEY) === "1"
    } catch {
      return false
    }
  })
  const aliveRef = useRef(true)
  useEffect(
    () => () => {
      aliveRef.current = false
    },
    [],
  )

  const loadThreads = useCallback(() => {
    api<unknown>("/api/threads/recent")
      .then((body) => {
        if (!aliveRef.current) return
        setThreads({
          status: "ready",
          data: parseRecentThreads(body),
          error: "",
          at: Date.now(),
        })
      })
      .catch((caught) => {
        if (!aliveRef.current) return
        setThreads((current) => ({
          status: "error",
          data: current.data,
          error:
            caught instanceof Error ? caught.message : "échec du chargement",
          at: current.at,
        }))
      })
  }, [])

  const loadJobs = useCallback(() => {
    api<JobLike[]>("/api/cron")
      .then((body) => {
        if (!aliveRef.current) return
        setJobs({
          status: "ready",
          data: pickUpcomingJobs(Array.isArray(body) ? body : []),
          error: "",
          at: Date.now(),
        })
      })
      .catch((caught) => {
        if (!aliveRef.current) return
        setJobs((current) => ({
          status: "error",
          data: current.data,
          error:
            caught instanceof Error ? caught.message : "échec du chargement",
          at: current.at,
        }))
      })
  }, [])

  const loadQuota = useCallback(() => {
    api<QuotaState>("/api/quota")
      .then((body) => {
        if (!aliveRef.current) return
        setQuota({ status: "ready", data: body, error: "", at: Date.now() })
      })
      .catch(() => {
        if (!aliveRef.current) return
        // Quota only powers an alert; its failure stays silent rather than
        // inventing an over/quota state.
        setQuota((current) => ({ ...current, status: "ready" }))
      })
  }, [])

  const loadProjects = useCallback(() => {
    api<{ projects?: unknown[] }>("/api/projects")
      .then((body) => {
        if (!aliveRef.current) return
        setProjects({
          status: "ready",
          data: Array.isArray(body.projects) ? body.projects.length : 0,
          error: "",
          at: Date.now(),
        })
      })
      .catch(() => {
        if (!aliveRef.current) return
        setProjects((current) => ({ ...current, status: "ready" }))
      })
  }, [])

  useEffect(() => {
    loadThreads()
    loadJobs()
    loadQuota()
    loadProjects()
  }, [loadThreads, loadJobs, loadQuota, loadProjects])

  // Phase poll: fast while starting, slow while sleeping (a cron or webhook
  // can wake the desktop behind our back); paused once running — /api/desktop
  // never starts anything itself.
  useEffect(() => {
    if (phase === "running" || !visible) return
    const timer = setInterval(
      () => {
        void api<DesktopStatus>("/api/desktop")
          .then((status) => {
            if (!aliveRef.current) return
            if (status.error) {
              if (phase === "starting") {
                setPhase("sleeping")
                setStartError(status.error)
              }
            } else {
              setStartError("")
              setPhase(status.phase)
            }
          })
          .catch(() => {})
      },
      phase === "starting" ? 2000 : 10_000,
    )
    return () => clearInterval(timer)
  }, [phase, visible])

  // Revalidate on focus and on the events the shell already carries.
  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden) {
        loadThreads()
        loadJobs()
      }
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => document.removeEventListener("visibilitychange", onVisible)
  }, [loadThreads, loadJobs])

  useEffect(
    () =>
      subscribe((event) => {
        if (event.type === "cron.changed") loadJobs()
        if (event.type === "threads.changed") loadThreads()
      }),
    [subscribe, loadJobs, loadThreads],
  )

  const desktop = DESKTOP_STATE_TEXT[phase]
  const hasModel = Boolean(me.model?.modelID)
  const hasThreads = threads.status === "ready" && threads.data.length > 0
  const checklist = buildChecklist({ hasModel, hasThreads })
  const showGuide = !checklistComplete(checklist) && !guideHidden

  const alerts: HomeAlert[] = buildAlerts({
    desktopError: startError,
    quota: quota.status === "ready" ? quota.data : null,
    failedJobs: (jobs.status === "ready" ? jobs.data : [])
      .filter((job) => job.lastError)
      .map((job) => ({
        id: job.id,
        name: job.name,
        lastError: job.lastError,
      })),
  })

  function newConversation(seed?: string) {
    if (seed) setComposerSeed(seed)
    markNewThreadIntent()
    go(CHAT_PATH)
  }

  function wake() {
    if (waking || phase !== "sleeping") return
    setWaking(true)
    setStartError("")
    setPhase("starting")
    void api("/api/desktop/start", { method: "POST" })
      .catch((caught) => {
        setPhase("sleeping")
        setStartError(
          caught instanceof Error ? caught.message : "démarrage impossible",
        )
      })
      .finally(() => setWaking(false))
  }

  function hideGuide() {
    setGuideHidden(true)
    try {
      localStorage.setItem(GUIDE_KEY, "1")
    } catch {
      // session-only
    }
  }

  const checklistLabels: Record<
    "model" | "first-thread" | "app",
    { title: string; detail: string; action?: { label: string; path: string } }
  > = {
    model: {
      title: "Choisir un modèle",
      detail: hasModel
        ? "Un modèle est sélectionné pour vos conversations."
        : "Choisissez le modèle d’assistant utilisé pour vos conversations.",
      action: hasModel
        ? undefined
        : { label: "Ouvrir les paramètres", path: "/config/chat" },
    },
    "first-thread": {
      title: "Démarrer une première conversation",
      detail: hasThreads
        ? "Votre première conversation est en place."
        : "Décrivez une tâche : Open-bot la réalise et vous pose les questions nécessaires.",
      action: hasThreads
        ? undefined
        : { label: "Nouvelle conversation", path: "" },
    },
    app: {
      title: "Ajouter une application (facultatif)",
      detail:
        "Des extensions peuvent ajouter des outils à vos conversations. Rien à installer pour commencer.",
      action: { label: "Parcourir les extensions", path: "/config/plugins" },
    },
  }

  return (
    <Box className="ob-scroll ob-view-enter" sx={{ flex: 1, minHeight: 0 }}>
      <Stack
        spacing={3}
        sx={{
          p: { xs: 1.5, sm: 3 },
          maxWidth: 1160,
          mx: "auto",
          width: "100%",
        }}
      >
        {/* Orientation + dominant action */}
        <Stack spacing={1.5}>
          <Typography variant="h5" component="h1">
            Que voulez-vous faire aujourd’hui?
          </Typography>
          <Typography
            variant="body2"
            color="textSecondary"
            sx={{ maxWidth: 640 }}
          >
            Décrivez votre objectif. Open-bot vous aide à le réaliser et vous
            demande les informations nécessaires au bon moment.
          </Typography>
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            sx={{ flexWrap: "wrap", rowGap: 1 }}
          >
            <Button
              variant="contained"
              size="large"
              startIcon={<ChatIcon width={18} height={18} />}
              onClick={() => newConversation()}
              sx={{ alignSelf: "flex-start" }}
            >
              Nouvelle conversation
            </Button>
            <Chip
              size="small"
              color={
                phase === "running"
                  ? "success"
                  : phase === "starting"
                    ? "primary"
                    : undefined
              }
              onClick={phase === "sleeping" ? wake : undefined}
              sx={{ cursor: phase === "sleeping" ? "pointer" : "default" }}
              label={
                phase === "running"
                  ? desktop.label
                  : phase === "starting"
                    ? `${desktop.label}…`
                    : `${desktop.label} — démarrer`
              }
            />
            <Typography variant="caption" color="textSecondary">
              {phase === "sleeping"
                ? "Vos conversations sont conservées; l’environnement démarre à la demande."
                : phase === "starting"
                  ? "Quelques minutes peuvent être nécessaires au premier démarrage."
                  : "L’environnement de travail est prêt."}
            </Typography>
          </Stack>
          {phase === "sleeping" ? (
            <Stack direction="row" spacing={1} alignItems="center">
              <Button
                size="small"
                variant="outlined"
                onClick={wake}
                disabled={waking}
              >
                Démarrer l’environnement
              </Button>
            </Stack>
          ) : null}
          {startError ? (
            <Typography variant="caption" color="error">
              {startError}
            </Typography>
          ) : null}
          <Stack
            direction="row"
            spacing={0.75}
            sx={{ flexWrap: "wrap", rowGap: 0.75 }}
            aria-label="Exemples de demandes"
          >
            {EXAMPLES.map((example) => (
              <Chip
                key={example}
                variant="outlined"
                onClick={() => newConversation(example)}
                label={example}
              />
            ))}
          </Stack>
        </Stack>

        {/* Attention requise — real, actionable problems only */}
        {alerts.length > 0 ? (
          <Stack spacing={1}>
            <SectionTitle>Attention requise</SectionTitle>
            {alerts.map((alert) => (
              <Paper
                key={alert.id}
                variant="outlined"
                sx={{
                  p: 1.5,
                  borderColor:
                    alert.severity === "error" ? "error.main" : "divider",
                }}
              >
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }}>
                    {alert.text}
                  </Typography>
                  <Button
                    size="small"
                    variant="text"
                    onClick={() => go(alert.actionPath)}
                  >
                    {alert.actionLabel}
                  </Button>
                </Stack>
              </Paper>
            ))}
          </Stack>
        ) : null}

        {/* Bien démarrer — only while real prerequisites are missing */}
        {showGuide ? (
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Typography variant="subtitle1" component="h2" sx={{ flex: 1 }}>
                Bien démarrer
              </Typography>
              <Button size="small" variant="text" onClick={hideGuide}>
                Masquer
              </Button>
            </Stack>
            <Stack spacing={1} sx={{ mt: 1 }}>
              {checklist.map((step) => {
                const labels = checklistLabels[step.id]
                return (
                  <Stack
                    key={step.id}
                    direction="row"
                    spacing={1}
                    alignItems="center"
                  >
                    <Box
                      aria-hidden
                      sx={{
                        width: 18,
                        height: 18,
                        borderRadius: "50%",
                        border: "2px solid",
                        borderColor: step.done ? "success.main" : "divider",
                        backgroundColor: step.done
                          ? "success.main"
                          : "transparent",
                        flexShrink: 0,
                      }}
                    />
                    <Typography
                      variant="body2"
                      sx={{ fontWeight: step.done ? 400 : 600 }}
                    >
                      {labels.title}
                      {step.done ? " — fait" : ""}
                    </Typography>
                    <Typography
                      variant="caption"
                      color="textSecondary"
                      sx={{
                        flex: 1,
                        minWidth: 0,
                        display: { xs: "none", sm: "block" },
                      }}
                    >
                      {labels.detail}
                    </Typography>
                    {labels.action && !step.done ? (
                      <Button
                        size="small"
                        variant="text"
                        onClick={() => {
                          const action = labels.action
                          if (!action) return
                          if (action.path) go(action.path)
                          else newConversation()
                        }}
                      >
                        {labels.action.label}
                      </Button>
                    ) : null}
                  </Stack>
                )
              })}
            </Stack>
          </Paper>
        ) : null}

        {/* Reprendre + À venir */}
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", md: "2fr 1fr" },
            gap: 3,
          }}
        >
          <Stack spacing={1}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <SectionTitle>Reprendre une conversation</SectionTitle>
              <Box sx={{ flex: 1 }} />
              <Button size="small" variant="text" onClick={() => go(CHAT_PATH)}>
                {NAV.chat}
              </Button>
            </Stack>
            {threads.status === "loading" ? (
              <Stack spacing={1} aria-busy="true">
                {[0, 1, 2].map((i) => (
                  <Box
                    key={i}
                    className="ob-skeleton"
                    sx={{ height: 52, borderRadius: "10px" }}
                  />
                ))}
                <output className="ob-sr-status">
                  Chargement des conversations
                </output>
              </Stack>
            ) : threads.status === "error" ? (
              <SectionError
                text="Impossible de charger vos conversations récentes. Vos échanges n’ont pas été supprimés."
                onRetry={loadThreads}
              />
            ) : threads.data.length === 0 ? (
              <Typography variant="body2" color="textSecondary">
                Aucune conversation nommée pour l’instant. Décrivez une tâche
                dans une nouvelle conversation pour commencer.
              </Typography>
            ) : (
              <Stack spacing={1}>
                {threads.data.map((thread) => (
                  <Paper
                    key={thread.sessionId}
                    variant="outlined"
                    sx={{ p: 1.5 }}
                  >
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography
                          variant="body2"
                          sx={{
                            fontWeight: 600,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {thread.title}
                        </Typography>
                        <Typography variant="caption" color="textSecondary">
                          {formatFrAgo(thread.createdAt)}
                        </Typography>
                      </Box>
                      <Button
                        size="small"
                        variant="text"
                        onClick={() => onOpenThread(thread.sessionId)}
                      >
                        Ouvrir
                      </Button>
                    </Stack>
                  </Paper>
                ))}
              </Stack>
            )}
          </Stack>

          <Stack spacing={1}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <SectionTitle>À venir</SectionTitle>
              <Box sx={{ flex: 1 }} />
              <Button
                size="small"
                variant="text"
                onClick={() => go("/automations")}
              >
                {NAV.automations}
              </Button>
            </Stack>
            {jobs.status === "loading" ? (
              <Stack spacing={1} aria-busy="true">
                {[0, 1].map((i) => (
                  <Box
                    key={i}
                    className="ob-skeleton"
                    sx={{ height: 52, borderRadius: "10px" }}
                  />
                ))}
              </Stack>
            ) : jobs.status === "error" ? (
              <SectionError
                text="Impossible de charger les automatisations."
                onRetry={loadJobs}
              />
            ) : jobs.data.length === 0 ? (
              <Typography variant="body2" color="textSecondary">
                Aucune automatisation à venir. Programmez une tâche récurrente
                dans {NAV.automations}.
              </Typography>
            ) : (
              <Stack spacing={1}>
                {jobs.data.map((job) => (
                  <Paper key={job.id} variant="outlined" sx={{ p: 1.5 }}>
                    <Typography
                      variant="body2"
                      sx={{
                        fontWeight: 600,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {job.name}
                    </Typography>
                    <Typography variant="caption" color="textSecondary">
                      Prochaine exécution {formatFrWhen(job.nextRunAt)}
                    </Typography>
                  </Paper>
                ))}
              </Stack>
            )}
          </Stack>
        </Box>

        {/* Applications disponibles — shortcuts, never embedded frames */}
        <Stack spacing={1}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <SectionTitle>Applications disponibles</SectionTitle>
            <Box sx={{ flex: 1 }} />
            <Button size="small" variant="text" onClick={() => go("/apps")}>
              Toutes les applications
            </Button>
            <Button
              size="small"
              variant="text"
              onClick={() => go("/config/plugins")}
            >
              Ajouter
            </Button>
          </Stack>
          {tabs.length === 0 ? (
            <Typography variant="body2" color="textSecondary">
              Aucune application pour l’instant. Des extensions peuvent ajouter
              des outils; certaines fonctionnent directement dans les
              conversations.
            </Typography>
          ) : (
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: {
                  xs: "1fr 1fr",
                  sm: "repeat(auto-fill, minmax(200px, 1fr))",
                },
                gap: 1,
              }}
            >
              {tabs.slice(0, 4).map((tab) => (
                <Paper key={tab.key} variant="outlined" sx={{ p: 1.5 }}>
                  <Button
                    variant="text"
                    startIcon={<ExtensionIcon width={18} height={18} />}
                    onClick={() => go(pluginPath(tab))}
                    sx={{ justifyContent: "flex-start", maxWidth: "100%" }}
                  >
                    <Box
                      Element="span"
                      sx={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {tab.title}
                    </Box>
                  </Button>
                </Paper>
              ))}
            </Box>
          )}
        </Stack>

        {/* Repères compacts */}
        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", rowGap: 1 }}>
          <Button
            size="small"
            variant="text"
            startIcon={<FolderIcon width={16} height={16} />}
            onClick={() => go(workspacePath("projects"))}
          >
            {NAV.projects}
            {projects.status === "ready" && projects.data > 0
              ? ` (${projects.data})`
              : ""}
          </Button>
          <Button
            size="small"
            variant="text"
            onClick={() => go(workspacePath("media"))}
          >
            {NAV.media}
          </Button>
          <Button size="small" variant="text" onClick={() => go(HELP_PATH)}>
            {NAV.help}
          </Button>
          {guideHidden && !checklistComplete(checklist) ? (
            <Button
              size="small"
              variant="text"
              onClick={() => {
                try {
                  localStorage.removeItem(GUIDE_KEY)
                } catch {}
                setGuideHidden(false)
              }}
            >
              Revoir le guide de démarrage
            </Button>
          ) : null}
        </Stack>
      </Stack>
    </Box>
  )
}
