import Box from "@shpaw415/mui-lite/Box"
import Button from "@shpaw415/mui-lite/Button"
import Paper from "@shpaw415/mui-lite/Paper"
import Typography from "@shpaw415/mui-lite/Typography"
import { useCallback, useEffect, useRef, useState } from "react"
import { api, type DesktopStatus, type Me, type QuotaState } from "./api"
import { Chip } from "./chip"
import {
  buildAlerts,
  buildChecklist,
  checklistComplete,
  formatFrAgo,
  formatFrNamedAgo,
  formatFrWhen,
  type HomeAlert,
  parseJobs,
  parseRecentThreads,
  pickUpcomingJobs,
  type RecentCoverage,
  type RecentThreadsResult,
  splitJobProblems,
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
  /** False once a load failed and the data on screen may be outdated. */
  fresh: boolean
}

function freshRes<T>(data: T): Res<T> {
  return { status: "loading", data, error: "", at: 0, fresh: false }
}

function guideStorageKey(userId: string): string {
  return `ob-home-guide-hidden:${userId}`
}

const EXAMPLES = [
  {
    label: "Recherche + résumé",
    seed: "Fais une recherche sur le web et résume-moi les points clés sous forme de liste.",
  },
  {
    label: "Courriel de suivi",
    seed: "Rédige un courriel de suivi poli pour une demande restée sans réponse depuis une semaine.",
  },
  {
    label: "Plan de travail",
    seed: "Prépare un plan détaillé pour organiser mon projet, étape par étape.",
  },
]

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <Typography
      variant="subtitle2"
      component="h2"
      sx={{
        mb: 1,
        color: "textSecondary",
        // mui-lite restyles any tag-level h2 at the h2 scale (2rem/300);
        // section headers must stay secondary to the page's h1.
        fontSize: "0.875rem",
        fontWeight: 600,
        lineHeight: 1.4,
      }}
    >
      {children}
    </Typography>
  )
}

function SectionError({
  text,
  onRetry,
  staleAt,
}: {
  text: string
  onRetry: () => void
  staleAt: number
}) {
  return (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Typography variant="body2" color="textSecondary">
        {text}
      </Typography>
      {staleAt ? (
        <Typography variant="caption" color="textSecondary">
          Données affichées du {formatFrWhen(staleAt)} — elles peuvent être
          anciennes.
        </Typography>
      ) : null}
      <Button size="small" variant="text" onClick={onRetry} sx={{ mt: 0.5 }}>
        Réessayer
      </Button>
    </Paper>
  )
}

/** Warning strip above still-rendered (possibly outdated) data. */
function StaleNote({ at, onRetry }: { at: number; onRetry: () => void }) {
  return (
    <Stack direction="row" spacing={1} alignItems="center">
      <Typography variant="caption" color="textSecondary" sx={{ flex: 1 }}>
        Actualisation impossible ({formatFrWhen(at)}) — les données peuvent être
        anciennes.
      </Typography>
      <Button size="small" variant="text" onClick={onRetry}>
        Réessayer
      </Button>
    </Stack>
  )
}

export function Dashboard({
  me,
  tabs,
  go,
  onOpenThread,
  onNewThread,
}: {
  me: Me
  tabs: PluginTab[]
  go: (path: string) => void
  onOpenThread: (sessionId: string) => void
  /** Every "Nouvelle conversation" CTA shares the shell-owned intent. */
  onNewThread: (seed?: string) => void
}) {
  const visible = useDocumentVisible()
  const { subscribe } = useEventStream(true)
  const [phase, setPhase] = useState<"starting" | "running" | "sleeping">(
    me.desktop ?? "sleeping",
  )
  // The profile's phase can be stale (cached /api/me); until a passive probe
  // confirms it, the badge says so instead of announcing readiness.
  const [phaseConfirmed, setPhaseConfirmed] = useState(false)
  const [startError, setStartError] = useState("")
  const [waking, setWaking] = useState(false)
  const [threads, setThreads] = useState<Res<RecentThreadsResult>>(
    freshRes({ threads: [], coverage: "titles" }),
  )
  const [jobs, setJobs] = useState<Res<ReturnType<typeof parseJobs>>>(
    freshRes([]),
  )
  const [quota, setQuota] = useState<Res<QuotaState | null>>(freshRes(null))
  const [projects, setProjects] = useState<Res<number>>(freshRes(0))
  const [guideHidden, setGuideHidden] = useState(() => {
    try {
      return localStorage.getItem(guideStorageKey(me.id)) === "1"
    } catch {
      return false
    }
  })
  const aliveRef = useRef(true)
  // Per-source request sequence: only the newest request may write its
  // source, so a slow earlier response can never overwrite a newer one.
  const seq = useRef({ threads: 0, jobs: 0, quota: 0, projects: 0, phase: 0 })
  useEffect(() => {
    // Re-armed on every effect cycle (StrictMode setup/cleanup/setup keeps
    // it true for the live instance); false only after real unmount.
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  const loadThreads = useCallback(() => {
    const request = ++seq.current.threads
    api<unknown>("/api/threads/recent")
      .then((body) => {
        if (!aliveRef.current || request !== seq.current.threads) return
        setThreads({
          status: "ready",
          data: parseRecentThreads(body),
          error: "",
          at: Date.now(),
          fresh: true,
        })
      })
      .catch((caught) => {
        if (!aliveRef.current || request !== seq.current.threads) return
        setThreads((current) => ({
          status: "error",
          data: current.data,
          error:
            caught instanceof Error ? caught.message : "échec du chargement",
          at: current.at,
          fresh: false,
        }))
      })
  }, [])

  const loadJobs = useCallback(() => {
    const request = ++seq.current.jobs
    api<unknown>("/api/cron")
      .then((body) => {
        if (!aliveRef.current || request !== seq.current.jobs) return
        setJobs({
          status: "ready",
          data: parseJobs(body),
          error: "",
          at: Date.now(),
          fresh: true,
        })
      })
      .catch((caught) => {
        if (!aliveRef.current || request !== seq.current.jobs) return
        setJobs((current) => ({
          status: "error",
          data: current.data,
          error:
            caught instanceof Error ? caught.message : "échec du chargement",
          at: current.at,
          fresh: false,
        }))
      })
  }, [])

  const loadQuota = useCallback(() => {
    const request = ++seq.current.quota
    api<QuotaState>("/api/quota")
      .then((body) => {
        if (!aliveRef.current || request !== seq.current.quota) return
        setQuota({
          status: "ready",
          data: body,
          error: "",
          at: Date.now(),
          fresh: true,
        })
      })
      .catch(() => {
        if (!aliveRef.current || request !== seq.current.quota) return
        // Quota only powers an alert. Unknown is not "no quota problem":
        // the data stays marked unfresh and no alert is invented.
        setQuota((current) => ({ ...current, status: "ready", fresh: false }))
      })
  }, [])

  const loadProjects = useCallback(() => {
    const request = ++seq.current.projects
    api<{ projects?: unknown[] }>("/api/projects")
      .then((body) => {
        if (!aliveRef.current || request !== seq.current.projects) return
        setProjects({
          status: "ready",
          data: Array.isArray(body.projects) ? body.projects.length : 0,
          error: "",
          at: Date.now(),
          fresh: true,
        })
      })
      .catch(() => {
        if (!aliveRef.current || request !== seq.current.projects) return
        // Unknown count is not zero: the shortcut renders without a number.
        setProjects((current) => ({
          ...current,
          status: "ready",
          fresh: false,
        }))
      })
  }, [])

  // Passive phase probe: /api/desktop never starts anything. Runs on mount
  // even when the profile said "running" — the profile can be stale — and
  // on every visibility return.
  const loadPhase = useCallback(() => {
    const request = ++seq.current.phase
    api<DesktopStatus>("/api/desktop")
      .then((status) => {
        if (!aliveRef.current || request !== seq.current.phase) return
        setPhaseConfirmed(true)
        if (status.error) {
          if (status.phase === "sleeping" || status.phase === "starting")
            setStartError(status.error)
          setPhase(status.phase)
        } else {
          setStartError("")
          setPhase(status.phase)
        }
      })
      .catch(() => {
        // A probe error proves neither sleep nor readiness: keep the last
        // known phase but stop advertising it as confirmed.
        if (!aliveRef.current || request !== seq.current.phase) return
        setPhaseConfirmed(false)
      })
  }, [])

  useEffect(() => {
    loadThreads()
    loadJobs()
    loadQuota()
    loadProjects()
    loadPhase()
  }, [loadThreads, loadJobs, loadQuota, loadProjects, loadPhase])

  // Phase poll: fast while starting, slow while sleeping (a cron or webhook
  // can wake the desktop behind our back); paused once running — /api/desktop
  // never starts anything itself.
  useEffect(() => {
    if (phase === "running" || !visible) return
    const timer = setInterval(loadPhase, phase === "starting" ? 2000 : 10_000)
    return () => clearInterval(timer)
  }, [phase, visible, loadPhase])

  // Revalidate on focus and on the events the shell already carries.
  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden) {
        loadThreads()
        loadJobs()
        loadPhase()
      }
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => document.removeEventListener("visibilitychange", onVisible)
  }, [loadThreads, loadJobs, loadPhase])

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
  // The summary's knowledge state drives both the guide and the empty state:
  // - coverage "full" (real session list, fresh read): an empty list is a
  //   CONFIRMED empty history — the guide may say "start a first one".
  // - coverage "titles" with rows: history exists — never a first-thread
  //   invitation, even though the full list was not readable.
  // - coverage "titles" empty: unknown — an empty name index is not proof
  //   of an empty history, so neither state is claimed.
  const recent = threads.data
  const threadsKnown =
    threads.status === "ready" &&
    threads.fresh &&
    (recent.coverage === "full" || recent.threads.length > 0)
  const hasThreads = threads.status === "ready" && recent.threads.length > 0
  const coverage: RecentCoverage = recent.coverage
  const checklist = buildChecklist({ hasModel, hasThreads, threadsKnown })
  const showGuide = !checklistComplete(checklist) && !guideHidden

  const alerts: HomeAlert[] = (() => {
    const all = jobs.status === "ready" ? jobs.data : []
    const { failed, overdue } = splitJobProblems(all)
    return buildAlerts({
      desktopError: startError,
      quota: quota.status === "ready" && quota.fresh ? quota.data : null,
      failedJobs: failed,
      overdueJobs: overdue,
    })
  })()

  const upcoming = pickUpcomingJobs(jobs.status === "ready" ? jobs.data : [])

  function hideGuide() {
    setGuideHidden(true)
    try {
      localStorage.setItem(guideStorageKey(me.id), "1")
    } catch {
      // session-only
    }
  }

  const checklistLabels: Record<
    "model" | "first-thread",
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
              onClick={() => onNewThread()}
              sx={{ alignSelf: "flex-start" }}
            >
              Nouvelle conversation
            </Button>
            <Chip
              size="small"
              label={
                phase === "starting"
                  ? `${desktop.label}…`
                  : desktop.label +
                    (phaseConfirmed ? "" : " — état à confirmer")
              }
              title={desktop.detail}
            />
            <Typography variant="caption" color="textSecondary">
              {phase === "sleeping"
                ? "Vos conversations sont conservées; l’environnement démarre à la demande."
                : phase === "starting"
                  ? "Quelques minutes peuvent être nécessaires au premier démarrage."
                  : phaseConfirmed
                    ? "L’environnement de travail est prêt."
                    : "État en cours de vérification."}
            </Typography>
          </Stack>
          {phase === "sleeping" ? (
            <Stack direction="row" spacing={1} alignItems="center">
              <Button
                size="small"
                variant="outlined"
                onClick={() => {
                  if (waking || phase !== "sleeping") return
                  setWaking(true)
                  setStartError("")
                  setPhase("starting")
                  void api("/api/desktop/start", { method: "POST" })
                    .catch((caught) => {
                      setPhase("sleeping")
                      setStartError(
                        caught instanceof Error
                          ? caught.message
                          : "démarrage impossible",
                      )
                    })
                    .finally(() => setWaking(false))
                }}
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
              <Button
                key={example.label}
                size="small"
                variant="outlined"
                onClick={() => onNewThread(example.seed)}
              >
                {example.label}
              </Button>
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
              <Typography
                variant="subtitle1"
                component="h2"
                sx={{ flex: 1, fontSize: "1rem", fontWeight: 600 }}
              >
                Bien démarrer
              </Typography>
              <Button size="small" variant="text" onClick={hideGuide}>
                Masquer
              </Button>
            </Stack>
            <Stack spacing={1} sx={{ mt: 1 }}>
              {checklist.map((step) => {
                const labels = checklistLabels[step.id]
                const unknown = step.state === "unknown"
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
                        borderColor: unknown
                          ? "divider"
                          : step.done
                            ? "success.main"
                            : "divider",
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
                      {unknown ? " — à vérifier" : ""}
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
                      {unknown
                        ? "La vérification est impossible tant que la liste n’a pas répondu."
                        : labels.detail}
                    </Typography>
                    {labels.action && !step.done && !unknown ? (
                      <Button
                        size="small"
                        variant="text"
                        onClick={() => {
                          const action = labels.action
                          if (!action) return
                          if (action.path) go(action.path)
                          else onNewThread()
                        }}
                      >
                        {labels.action.label}
                      </Button>
                    ) : null}
                  </Stack>
                )
              })}
              {/* Optional suggestion, never a fake unfinished step. */}
              <Stack direction="row" spacing={1} alignItems="center">
                <Box
                  aria-hidden
                  sx={{
                    width: 18,
                    height: 18,
                    flexShrink: 0,
                    textAlign: "center",
                  }}
                >
                  <ExtensionIcon width={16} height={16} />
                </Box>
                <Typography variant="body2">
                  Suggestion — ajouter des applications
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
                  Des extensions peuvent ajouter des outils. Rien à installer
                  pour commencer.
                </Typography>
                <Button
                  size="small"
                  variant="text"
                  onClick={() => go("/config/plugins")}
                >
                  Parcourir les extensions
                </Button>
              </Stack>
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
            ) : threads.status === "error" && recent.threads.length === 0 ? (
              <SectionError
                text="Impossible de charger vos conversations récentes. Vos échanges n’ont pas été supprimés."
                onRetry={loadThreads}
                staleAt={threads.at}
              />
            ) : (
              <Stack spacing={1}>
                {threads.status === "error" ? (
                  <StaleNote at={threads.at} onRetry={loadThreads} />
                ) : null}
                {recent.threads.length === 0 ? (
                  coverage === "full" ? (
                    <Typography variant="body2" color="textSecondary">
                      Aucune conversation pour l’instant. Décrivez une tâche
                      dans une nouvelle conversation pour commencer.
                    </Typography>
                  ) : (
                    // Index vide ≠ historique vide : la couverture réelle
                    // n'est pas connue (environnement en veille ou liste
                    // injoignable). Aucune fausse invitation à démarrer.
                    <Stack spacing={1}>
                      <Typography variant="body2" color="textSecondary">
                        Votre historique n’est pas disponible dans cet aperçu.
                      </Typography>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => go(CHAT_PATH)}
                        sx={{ alignSelf: "flex-start" }}
                      >
                        Ouvrir les conversations
                      </Button>
                    </Stack>
                  )
                ) : (
                  <>
                    {coverage === "titles" ? (
                      <Typography variant="caption" color="textSecondary">
                        Aperçu partiel — seules les conversations nommées
                        apparaissent ici.
                      </Typography>
                    ) : null}
                    {recent.threads.map((thread) => (
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
                              {coverage === "full"
                                ? `activité ${formatFrAgo(thread.createdAt)}`
                                : formatFrNamedAgo(thread.createdAt)}
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
                  </>
                )}
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
            ) : jobs.status === "error" && jobs.data.length === 0 ? (
              <SectionError
                text="Impossible de charger les automatisations."
                onRetry={loadJobs}
                staleAt={jobs.at}
              />
            ) : (
              <Stack spacing={1}>
                {jobs.status === "error" ? (
                  <StaleNote at={jobs.at} onRetry={loadJobs} />
                ) : null}
                {upcoming.length === 0 ? (
                  <Typography variant="body2" color="textSecondary">
                    Aucune automatisation à venir. Programmez une tâche
                    récurrente dans {NAV.automations}.
                  </Typography>
                ) : (
                  upcoming.map((job) => (
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
                  ))
                )}
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
            {projects.status === "ready" && projects.fresh && projects.data > 0
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
                  localStorage.removeItem(guideStorageKey(me.id))
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
