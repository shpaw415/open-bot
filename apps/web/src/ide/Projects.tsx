import Alert from "@shpaw415/mui-lite/Alert"
import Box from "@shpaw415/mui-lite/Box"
import Button from "@shpaw415/mui-lite/Button"
import Divider from "@shpaw415/mui-lite/Divider"
import IconButton from "@shpaw415/mui-lite/IconButton"
import { CircularProgress } from "@shpaw415/mui-lite/Progress"
import Skeleton from "@shpaw415/mui-lite/Skeleton"
import TextField from "@shpaw415/mui-lite/TextField"
import Typography from "@shpaw415/mui-lite/Typography"
import { type ReactNode, useCallback, useEffect, useState } from "react"
import AccessibleDialog, {
  DialogActions,
  DialogContent,
  DialogTitle,
} from "../AccessibleDialog"
import { api } from "../api"
import { Chip } from "../chip"
import type { EventStream } from "../hooks"
import { useMobile } from "../hooks"
import {
  AddIcon,
  ChevronRightIcon,
  DeleteIcon,
  FolderIcon,
  RefreshIcon,
} from "../icons"
import { OPEN_PROJECT_EVENT, takePendingProject } from "../open-project"
import Stack from "../stack"
import { Tip } from "../Tip"
import { Ide } from "./Ide"
import { groupProjects } from "./project-groups"
import type { ProjectInfo } from "./types"

const EASE = "cubic-bezier(0.2, 0, 0, 1)"
const SKELETON_ROWS = ["a", "b", "c", "d", "e", "f"]
const ROW_SHADOW =
  "0 1px 2px rgba(0, 0, 0, 0.10), 0 2px 8px rgba(0, 0, 0, 0.08)"
const BORDER_REST = "rgba(var(--text-main), 0.14)"
const META = "rgba(var(--text-main), 0.62)"
const META_FADED = "rgba(var(--text-main), 0.45)"

const NARROW = "@media (max-width: 419.95px)"
const REDUCED = "@media (prefers-reduced-motion: reduce)"

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function createdLabel(ms: number): string {
  const date = new Date(ms)
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year:
      date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  })
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return "•"
  return words
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase()
}

const tint = {
  general: {
    background: "rgba(var(--bg-primary-main), 0.14)",
    border: "rgba(var(--bg-primary-main), 0.30)",
    color: "rgb(var(--bg-primary-main))",
  },
  plugin: {
    background: "rgba(var(--bg-secondary-main), 0.16)",
    border: "rgba(var(--bg-secondary-main), 0.30)",
    color: "rgb(var(--bg-secondary-main))",
  },
} as const

function ProjectCard({
  project,
  plugin,
  onOpen,
  onRemove,
}: {
  project: ProjectInfo
  plugin: boolean
  onOpen: (project: ProjectInfo) => void
  onRemove: (project: ProjectInfo) => void
}) {
  const palette = plugin ? tint.plugin : tint.general
  const narrow = useMobile(419.95)
  return (
    <Box
      role="button"
      tabIndex={0}
      aria-label={`Ouvrir ${project.name}`}
      onClick={() => onOpen(project)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          onOpen(project)
        }
      }}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        minHeight: narrow ? 68 : 64,
        p: narrow ? "10px 12px" : "12px 12px 12px 14px",
        borderRadius: "16px",
        borderStyle: "solid",
        borderWidth: "1px",
        borderColor: BORDER_REST,
        backgroundColor: "background.paper",
        cursor: "pointer",
        transition: `border-color 150ms ${EASE}, background-color 150ms ${EASE}, transform 180ms ${EASE}, box-shadow 180ms ${EASE}`,
        "&:hover": {
          borderColor: "rgba(var(--bg-primary-main), 0.55) !important",
          backgroundColor: "action.hover !important",
          transform: "translateY(-1px)",
          boxShadow: ROW_SHADOW,
          "& .proj-chevron": { opacity: 1 },
        },
        "&:active": { transform: "scale(0.99)" },
        "&:focus-visible": {
          outline: "2px solid",
          outlineColor: "primary.main",
          outlineOffset: "2px",
          backgroundColor: "action.hover !important",
        },
        [REDUCED]: {
          transition: "none",
          "&:hover, &:active": { transform: "none", boxShadow: "none" },
        },
      }}
    >
      <Box
        sx={{
          width: narrow ? 36 : 40,
          height: narrow ? 36 : 40,
          borderRadius: narrow ? "10px" : "12px",
          borderStyle: "solid",
          borderWidth: "1px",
          borderColor: palette.border,
          backgroundColor: palette.background,
          color: palette.color,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          position: "relative",
          userSelect: "none",
        }}
      >
        <Typography
          sx={{
            fontSize: 15,
            fontWeight: 700,
            lineHeight: 1,
            letterSpacing: "0.02em",
          }}
        >
          {initials(project.name)}
        </Typography>
        {plugin ? (
          <Box
            sx={{
              position: "absolute",
              top: -3,
              right: -3,
              width: 10,
              height: 10,
              borderRadius: "50%",
              backgroundColor: tint.plugin.color,
              border: "2px solid",
              borderColor: "background.paper",
              boxSizing: "content-box",
            }}
          />
        ) : null}
      </Box>
      <Stack spacing={0.25} sx={{ flex: 1, minWidth: 0 }}>
        <Tip title={project.name}>
          <Typography
            sx={{
              fontSize: 15,
              fontWeight: 600,
              lineHeight: "22px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {project.name}
          </Typography>
        </Tip>
        <Tip title={project.path}>
          <Typography
            sx={{
              fontSize: 12,
              lineHeight: "18px",
              color: META,
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {project.path}
          </Typography>
        </Tip>
      </Stack>
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        sx={{ flexShrink: 0 }}
      >
        <Typography
          variant="caption"
          sx={{
            color: META,
            fontWeight: 500,
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
            userSelect: "none",
          }}
        >
          {createdLabel(project.createdAt)}
        </Typography>
        <Box
          className="proj-divider"
          sx={{
            width: 1,
            height: 20,
            backgroundColor: "divider",
            [NARROW]: { display: "none" },
          }}
        />
        <Box
          className="proj-chevron"
          sx={{
            display: "flex",
            color: META_FADED,
            opacity: 0.7,
            transition: `opacity 150ms ${EASE}`,
            [NARROW]: { display: "none" },
          }}
        >
          <ChevronRightIcon width={18} height={18} />
        </Box>
        <Box
          className="proj-del"
          sx={{
            display: "flex",
            "& svg": { color: META },
            "& button:hover": {
              backgroundColor: "rgba(var(--bg-error-main), 0.10) !important",
            },
            "& button:hover svg": {
              color: "rgb(var(--bg-error-main))",
            },
          }}
        >
          <Tip title="Retirer le lien du projet">
            <IconButton
              size="small"
              aria-label={`Retirer ${project.name}`}
              onClick={(event) => {
                event.stopPropagation()
                onRemove(project)
              }}
            >
              <DeleteIcon width={18} height={18} />
            </IconButton>
          </Tip>
        </Box>
      </Stack>
    </Box>
  )
}

function SectionHeader({
  label,
  count,
  hint,
  palette,
}: {
  label: string
  count: number
  hint?: string
  palette: (typeof tint)["general"] | (typeof tint)["plugin"]
}) {
  return (
    <Stack
      direction="row"
      spacing={1}
      alignItems="center"
      component="h3"
      sx={{ m: 0, mt: 2.5, mb: 1, px: 0.25 }}
    >
      <Typography
        variant="caption"
        sx={{
          color: "text.secondary",
          fontWeight: 700,
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          lineHeight: "20px",
        }}
      >
        {label}
      </Typography>
      <Chip
        size="small"
        sx={{
          height: 20,
          borderRadius: "8px",
          bgcolor: palette.background,
          color: palette.color,
          "& .MUI_Chip_Content": {
            padding: 0,
            paddingRight: "8px",
            paddingLeft: "8px",
            fontSize: 12,
            fontWeight: 600,
            lineHeight: "20px",
          },
        }}
      >
        {count}
      </Chip>
      {hint ? (
        <Typography
          variant="caption"
          sx={{
            color: META_FADED,
            ml: "auto",
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
            display: { xs: "none", md: "block" },
          }}
        >
          {hint}
        </Typography>
      ) : null}
    </Stack>
  )
}

function SkeletonRow() {
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        minHeight: 64,
        p: "12px 12px 12px 14px",
        borderRadius: "16px",
        borderStyle: "solid",
        borderWidth: "1px",
        borderColor: BORDER_REST,
        backgroundColor: "background.paper",
      }}
    >
      <Skeleton variant="rounded" width={40} height={40} />
      <Stack spacing={1} sx={{ flex: 1 }}>
        <Skeleton variant="text" width="55%" height={15} />
        <Skeleton variant="text" width="85%" height={12} />
      </Stack>
      <Skeleton variant="rounded" width={48} height={14} />
    </Box>
  )
}

function StatePanel({
  glyph,
  title,
  body,
  action,
}: {
  glyph: ReactNode
  title: string
  body: string
  action?: ReactNode
}) {
  return (
    <Stack
      alignItems="center"
      spacing={1.5}
      sx={{ py: 8, px: 3, maxWidth: 420, mx: "auto", textAlign: "center" }}
    >
      <Box
        sx={{
          position: "relative",
          width: 120,
          height: 120,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          mb: 0.5,
        }}
      >
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            border: "1px dashed",
            borderColor: "divider",
          }}
        />
        <Box
          sx={{
            width: 96,
            height: 96,
            borderRadius: "50%",
            backgroundColor: "action.hover",
            color: "text.secondary",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {glyph}
        </Box>
      </Box>
      <Typography sx={{ fontSize: 16, fontWeight: 600 }}>{title}</Typography>
      <Typography variant="body2" sx={{ color: "text.secondary" }}>
        {body}
      </Typography>
      {action}
    </Stack>
  )
}

export function Projects({
  subscribe,
  threadBar,
  onThreadDock,
}: {
  subscribe?: EventStream["subscribe"]
  threadBar?: ReactNode
  onThreadDock?: (el: HTMLDivElement | null) => void
}) {
  const mobile = useMobile()
  const [projects, setProjects] = useState<ProjectInfo[] | null>(null)
  const [error, setError] = useState("")
  const [loadError, setLoadError] = useState("")
  const [selected, setSelected] = useState<ProjectInfo | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState("")
  const [folder, setFolder] = useState("")
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState<ProjectInfo | null>(null)

  const load = useCallback(() => {
    api<{ projects: ProjectInfo[] }>("/api/projects")
      .then((body) => {
        setProjects(body.projects ?? [])
        setLoadError("")
      })
      .catch((caught) =>
        setLoadError(caught instanceof Error ? caught.message : "load failed"),
      )
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!subscribe) return
    return subscribe((event) => {
      if (event.type === "projects.changed") load()
    })
  }, [subscribe, load])

  // "Open this project" pipeline (search results, future links): an event
  // for the mounted view, plus a pending slot for the race where the pick
  // navigated to /projects and this view mounts after the event fired.
  const [pendingOpen, setPendingOpen] = useState("")
  useEffect(() => {
    const onOpen = (event: Event) => {
      const id = (event as CustomEvent<{ projectId?: string }>).detail
        ?.projectId
      if (!id) return
      setPendingOpen(id)
    }
    window.addEventListener(OPEN_PROJECT_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_PROJECT_EVENT, onOpen)
  }, [])
  useEffect(() => {
    const raced = takePendingProject()
    if (raced) {
      setPendingOpen(raced)
      return
    }
    // URL restore: /projects?id=X selects that project through the same
    // pipeline — no second mechanism. Back/Forward and reload then land on
    // the same project; an unknown or removed id just stays on the list.
    const fromUrl = new URLSearchParams(location.search).get("id")
    if (fromUrl) setPendingOpen(fromUrl)
  }, [])
  useEffect(() => {
    if (!pendingOpen || !projects) return
    const found = projects.find((project) => project.id === pendingOpen)
    if (!found) return
    setSelected(found)
    setPendingOpen("")
  }, [pendingOpen, projects])

  async function create() {
    const trimmed = name.trim()
    if (busy) return
    const folderPath = folder.trim()
    if (!trimmed && !folderPath) return
    setBusy(true)
    setError("")
    try {
      const body = await api<{ project: ProjectInfo }>("/api/projects", {
        method: "POST",
        body: JSON.stringify({
          name: trimmed,
          ...(folderPath ? { path: folderPath } : {}),
        }),
      })
      setProjects((current) => [...(current ?? []), body.project])
      setCreateOpen(false)
      setName("")
      setFolder("")
      setSelected(body.project)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "create failed")
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!removing || busy) return
    setBusy(true)
    setError("")
    try {
      await api(`/api/projects/${removing.id}`, { method: "DELETE" })
      setProjects((current) =>
        (current ?? []).filter((project) => project.id !== removing.id),
      )
      setRemoving(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "delete failed")
    } finally {
      setBusy(false)
    }
  }

  if (selected) {
    return (
      <Box
        sx={{
          height: "100%",
          minHeight: 0,
          position: "relative",
        }}
      >
        <Ide
          project={selected}
          subscribe={subscribe}
          threadBar={threadBar}
          onThreadDock={onThreadDock}
          onBack={() => {
            setSelected(null)
            // Back to the list also drops the ?id= deep link so a reload
            // lands on the list, not back inside the project.
            if (location.search)
              history.replaceState(null, "", location.pathname)
            load()
          }}
        />
      </Box>
    )
  }

  const slug = slugify(name)
  const grouped = projects ? groupProjects(projects) : null
  const total = projects?.length ?? 0
  const loading = projects === null && !loadError

  return (
    <Box
      sx={{
        height: "100%",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        p: mobile ? 2 : 2.5,
      }}
    >
      <Stack
        sx={{ width: "100%", maxWidth: 880, mx: "auto", minHeight: 0, flex: 1 }}
      >
        <Stack
          direction="row"
          alignItems="flex-end"
          spacing={2}
          sx={{ flexWrap: "wrap", rowGap: 1 }}
        >
          <Stack spacing={0.25} sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="h6" component="h1">
              Projets
            </Typography>
            <Typography variant="caption" sx={{ color: META }}>
              {loading
                ? "Chargement des espaces de travail…"
                : `Un projet regroupe des fichiers dans l’espace Open-bot — ${total} espace${total === 1 ? "" : "s"}`}
            </Typography>
          </Stack>
          <Button
            variant="contained"
            startIcon={<AddIcon width={18} height={18} />}
            onClick={() => setCreateOpen(true)}
          >
            Nouveau projet
          </Button>
        </Stack>
        {mobile ? null : <Divider sx={{ mt: 2, mb: 0.5 }} />}
        {error ? (
          <Alert severity="error" onClose={() => setError("")} sx={{ mt: 1.5 }}>
            {error}
          </Alert>
        ) : null}
        {loading ? (
          <Stack
            spacing={1.25}
            sx={{ overflowY: "auto", mt: 2 }}
            aria-busy="true"
          >
            {SKELETON_ROWS.map((row) => (
              <SkeletonRow key={row} />
            ))}
          </Stack>
        ) : loadError ? (
          <StatePanel
            glyph={<RefreshIcon width={40} height={40} />}
            title="Impossible de charger les projets"
            body="Vérifiez la connexion et réessayez."
            action={
              <Button
                variant="outlined"
                startIcon={<RefreshIcon width={18} height={18} />}
                onClick={load}
              >
                Réessayer
              </Button>
            }
          />
        ) : total === 0 ? (
          <StatePanel
            glyph={
              <FolderIcon width={44} height={44} style={{ opacity: 0.7 }} />
            }
            title="Aucun projet"
            body="Créez un dossier de travail pour l’ouvrir dans l’éditeur et le référencer avec @projects dans une conversation. Les espaces des extensions sont regroupés sous Extensions. Retirer un projet ne supprime jamais ses fichiers."
            action={
              <Button
                variant="outlined"
                startIcon={<AddIcon width={18} height={18} />}
                onClick={() => setCreateOpen(true)}
              >
                Nouveau projet
              </Button>
            }
          />
        ) : (
          <Stack
            spacing={1.25}
            sx={{ overflowY: "auto", minHeight: 0, mt: 1, pb: 1 }}
          >
            {grouped && grouped.plugins.length > 0 ? (
              <>
                <SectionHeader
                  label="Extensions"
                  count={grouped.plugins.length}
                  hint="~/plugins-create"
                  palette={tint.plugin}
                />
                {grouped.plugins.map((project) => (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    plugin
                    onOpen={setSelected}
                    onRemove={setRemoving}
                  />
                ))}
              </>
            ) : null}
            {grouped && grouped.general.length > 0 ? (
              <>
                <SectionHeader
                  label="Généraux"
                  count={grouped.general.length}
                  palette={tint.general}
                />
                {grouped.general.map((project) => (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    plugin={false}
                    onOpen={setSelected}
                    onRemove={setRemoving}
                  />
                ))}
              </>
            ) : null}
          </Stack>
        )}
      </Stack>

      <AccessibleDialog
        open={createOpen}
        onClose={() => !busy && setCreateOpen(false)}
      >
        <DialogTitle>Nouveau projet</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ pt: 0.5 }}>
            <TextField
              label="Nom du projet"
              value={name}
              autoFocus
              sx={{ width: "100%" }}
              disabled={busy}
              placeholder="Mon application"
              onChange={(event) => setName(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void create()
              }}
              helpText={
                folder.trim()
                  ? "Enregistre ce dossier existant"
                  : slug
                    ? `Les fichiers vivent dans /home/agent/workspace/${slug} sur le desktop`
                    : "Lettres, chiffres et tirets"
              }
            />
            <TextField
              label="Dossier existant (facultatif)"
              value={folder}
              sx={{ width: "100%" }}
              disabled={busy}
              placeholder="/home/agent/plugins-create/my-plugin"
              onChange={(event) => setFolder(event.currentTarget.value)}
              helpText="Désigne un dossier qui existe déjà sur le desktop"
            />
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              {folder.trim()
                ? "Le dossier doit exister sous /home/agent; le nom reprend par défaut son dernier segment."
                : "Le dossier est créé sur le desktop s’il n’existe pas encore."}{" "}
              Mentionnez le projet dans une conversation avec{" "}
              <Box Element="code">@projects/{slug || "nom"}</Box> (le nom du
              projet; le slug fonctionne aussi).
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setCreateOpen(false)}>
            Annuler
          </Button>
          <Button
            variant="contained"
            disabled={busy || (!slug && !folder.trim())}
            startIcon={busy ? <CircularProgress size={1.1} /> : undefined}
            onClick={() => void create()}
          >
            Créer le projet
          </Button>
        </DialogActions>
      </AccessibleDialog>

      <AccessibleDialog
        open={removing !== null}
        onClose={() => !busy && setRemoving(null)}
      >
        <DialogTitle>Retirer « {removing?.name} » ?</DialogTitle>
        <DialogContent>
          <Typography>
            {removing?.name} ne sera plus listé ici ni dans @projects. Les
            fichiers du desktop restent en place dans {removing?.path}.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setRemoving(null)}>
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={busy}
            onClick={() => void remove()}
          >
            Retirer
          </Button>
        </DialogActions>
      </AccessibleDialog>
    </Box>
  )
}
