import Alert from "@shpaw415/mui-lite/Alert"
import Box from "@shpaw415/mui-lite/Box"
import Button from "@shpaw415/mui-lite/Button"
import Dialog, {
  DialogActions,
  DialogContent,
  DialogTitle,
} from "@shpaw415/mui-lite/Dialog"
import IconButton from "@shpaw415/mui-lite/IconButton"
import { CircularProgress } from "@shpaw415/mui-lite/Progress"
import Stack from "@shpaw415/mui-lite/Stack"
import TextField from "@shpaw415/mui-lite/TextField"
import ToolTip from "@shpaw415/mui-lite/ToolTip"
import Typography from "@shpaw415/mui-lite/Typography"
import { type ReactNode, useCallback, useEffect, useState } from "react"
import { api } from "../api"
import type { EventStream } from "../hooks"
import { useMobile } from "../hooks"
import { AddIcon, DeleteIcon, FolderIcon } from "../icons"
import { Ide } from "./Ide"
import type { ProjectInfo } from "./types"

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
  const [selected, setSelected] = useState<ProjectInfo | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState("")
  const [folder, setFolder] = useState("")
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState<ProjectInfo | null>(null)

  const load = useCallback(() => {
    api<{ projects: ProjectInfo[] }>("/api/projects")
      .then((body) => setProjects(body.projects ?? []))
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : "load failed"),
      )
  }, [])

  useEffect(() => {
    load()
  }, [load])

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
            load()
          }}
        />
      </Box>
    )
  }

  const slug = slugify(name)

  return (
    <Stack
      sx={{ height: "100%", minHeight: 0, p: mobile ? 0.75 : 1, gap: 0.75 }}
    >
      <Stack direction="row" spacing={1} alignItems="center">
        <Typography variant="h6" sx={{ flex: 1 }}>
          Projects
        </Typography>
        <Button
          size="small"
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setCreateOpen(true)}
        >
          New project
        </Button>
      </Stack>
      {error ? (
        <Alert severity="error" onClose={() => setError("")}>
          {error}
        </Alert>
      ) : null}
      {projects === null ? (
        <Stack alignItems="center" sx={{ py: 6 }}>
          <CircularProgress />
        </Stack>
      ) : projects.length === 0 ? (
        <Stack
          alignItems="center"
          spacing={1}
          sx={{ py: 8, color: "text.secondary" }}
        >
          <FolderIcon width={44} height={44} style={{ opacity: 0.4 }} />
          <Typography>No projects yet</Typography>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            A project is a folder in the desktop workspace you can browse here
            and mention with @projects in chat.
          </Typography>
          <Button
            variant="outlined"
            startIcon={<AddIcon />}
            onClick={() => setCreateOpen(true)}
          >
            New project
          </Button>
        </Stack>
      ) : (
        <Stack spacing={1} sx={{ overflowY: "auto", minHeight: 0, pb: 1 }}>
          {projects.map((project) => (
            <Stack
              key={project.id}
              direction="row"
              spacing={1.5}
              alignItems="center"
              sx={{
                p: 1.25,
                borderRadius: 2,
                border: 1,
                borderColor: "divider",
                backgroundColor: "background.paper",
                cursor: "pointer",
                "&:hover": { borderColor: "primary.main" },
              }}
              onClick={() => setSelected(project)}
            >
              <Box
                sx={{
                  width: 38,
                  height: 38,
                  borderRadius: 1.5,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  backgroundColor: "action.hover",
                  color: "#c09553",
                }}
              >
                <FolderIcon />
              </Box>
              <Stack sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontWeight: 600 }}>{project.name}</Typography>
                <Typography
                  variant="caption"
                  sx={{
                    color: "text.secondary",
                    fontFamily: "monospace",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {project.path}
                </Typography>
              </Stack>
              <Typography
                variant="caption"
                sx={{ color: "text.secondary", flexShrink: 0 }}
              >
                {createdLabel(project.createdAt)}
              </Typography>
              <ToolTip title="Remove project link">
                <IconButton
                  size="small"
                  aria-label={`Remove ${project.name}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    setRemoving(project)
                  }}
                >
                  <DeleteIcon />
                </IconButton>
              </ToolTip>
            </Stack>
          ))}
        </Stack>
      )}

      <Dialog open={createOpen} onClose={() => !busy && setCreateOpen(false)}>
        <DialogTitle>New project</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ pt: 0.5 }}>
            <TextField
              label="Project name"
              value={name}
              autoFocus
              sx={{ width: "100%" }}
              disabled={busy}
              placeholder="My App"
              onChange={(event) => setName(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void create()
              }}
              helpText={
                folder.trim()
                  ? "Registers this existing folder"
                  : slug
                    ? `Files live in /home/agent/workspace/${slug} on the desktop`
                    : "Letters, numbers and dashes"
              }
            />
            <TextField
              label="Existing folder (optional)"
              value={folder}
              sx={{ width: "100%" }}
              disabled={busy}
              placeholder="/home/agent/plugins-create/my-plugin"
              onChange={(event) => setFolder(event.currentTarget.value)}
              helpText="Point the project at a folder that already exists on the desktop"
            />
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              {folder.trim()
                ? "The folder must exist under /home/agent; the name defaults to its last segment."
                : "The folder is created on the desktop if it does not exist yet."}{" "}
              Mention the project in chat with{" "}
              <Box Element="code">@projects/{slug || "name"}</Box> (the project
              name; the slug works too).
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setCreateOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={busy || (!slug && !folder.trim())}
            startIcon={busy ? <CircularProgress size={1.1} /> : undefined}
            onClick={() => void create()}
          >
            Create project
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={removing !== null}
        onClose={() => !busy && setRemoving(null)}
      >
        <DialogTitle>Remove project link?</DialogTitle>
        <DialogContent>
          <Typography>
            {removing?.name} will no longer appear here or in @projects. Files
            on the desktop stay untouched at {removing?.path}.
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
            Remove
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
