import Alert from "@shpaw415/mui-lite/Alert"
import Box from "@shpaw415/mui-lite/Box"
import Button from "@shpaw415/mui-lite/Button"
import CheckBox from "@shpaw415/mui-lite/CheckBox"
import Chip from "@shpaw415/mui-lite/Chip"
import Dialog, {
  DialogActions,
  DialogContent,
  DialogTitle,
} from "@shpaw415/mui-lite/Dialog"
import FormControlLabel from "@shpaw415/mui-lite/FormControlLabel"
import IconButton from "@shpaw415/mui-lite/IconButton"
import { CircularProgress } from "@shpaw415/mui-lite/Progress"
import Stack from "@shpaw415/mui-lite/Stack"
import Typography from "@shpaw415/mui-lite/Typography"
import { useCallback, useEffect, useMemo, useState } from "react"
import { api } from "./api"
import type { EventStream } from "./hooks"
import {
  ArrowBackIcon,
  ChevronRightIcon,
  DeleteIcon,
  DescriptionIcon,
  DownloadIcon,
  FolderIcon,
  ImageIcon,
  Model3dIcon,
  VideoIcon,
} from "./icons"
import { Model3dView } from "./Model3dView"

type Kind = "image" | "video" | "model3d" | "file"
type Filter = "all" | Kind

type Latest = { id: string; kind: Kind; name: string; url: string }

type Album = {
  id: string
  name: string
  sessionId: string | null
  createdAt: number
  count: number
  latest: Latest | null
}

type Item = {
  id: string
  albumId: string
  kind: Kind
  name: string
  title: string
  mime: string
  bytes: number
  sourcePath: string
  createdAt: number
  url: string
}

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "image", label: "Pictures" },
  { key: "model3d", label: "3D" },
  { key: "video", label: "Video" },
  { key: "file", label: "Other" },
]

function kindIcon(kind: Kind) {
  if (kind === "image") return <ImageIcon />
  if (kind === "video") return <VideoIcon />
  if (kind === "model3d") return <Model3dIcon />
  return <DescriptionIcon />
}

function formatBytes(value: number) {
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.round(value / 1024))} KB`
}

export function MediaVault({
  subscribe,
}: {
  subscribe?: EventStream["subscribe"]
}) {
  const [albums, setAlbums] = useState<Album[] | null>(null)
  const [albumId, setAlbumId] = useState("")
  const [items, setItems] = useState<Item[]>([])
  const [filter, setFilter] = useState<Filter>("all")
  const [viewerId, setViewerId] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [dropAlbum, setDropAlbum] = useState<Album | null>(null)
  const [dropItem, setDropItem] = useState<Item | null>(null)
  const [dropSource, setDropSource] = useState(true)

  function askDeleteAlbum(row: Album) {
    setDropSource(true)
    setDropAlbum(row)
  }

  function askDeleteItem(row: Item) {
    setDropSource(true)
    setDropItem(row)
  }

  const loadAlbums = useCallback(() => {
    api<{ albums: Album[] }>("/api/media/albums")
      .then((body) => setAlbums(body.albums ?? []))
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : "load failed"),
      )
  }, [])

  const loadItems = useCallback((id: string) => {
    if (!id) return
    api<{ items: Item[] }>(`/api/media/albums/${encodeURIComponent(id)}/items`)
      .then((body) => setItems(body.items ?? []))
      .catch((caught) => {
        setAlbumId("")
        setItems([])
        setError(caught instanceof Error ? caught.message : "load failed")
      })
  }, [])

  useEffect(() => {
    loadAlbums()
  }, [loadAlbums])

  useEffect(() => {
    if (!albumId) return
    loadItems(albumId)
  }, [albumId, loadItems])

  useEffect(() => {
    if (!subscribe) return
    return subscribe((event) => {
      if (event.type !== "media.changed" && event.type !== "session.idle")
        return
      loadAlbums()
      if (albumId) loadItems(albumId)
    })
  }, [subscribe, loadAlbums, loadItems, albumId])

  const shown = useMemo(
    () =>
      filter === "all" ? items : items.filter((item) => item.kind === filter),
    [items, filter],
  )
  const viewerIndex = shown.findIndex((item) => item.id === viewerId)
  const current = viewerIndex >= 0 ? shown[viewerIndex] : null
  const album = albums?.find((row) => row.id === albumId) ?? null

  useEffect(() => {
    if (!current) return
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setViewerId("")
        return
      }
      if (event.key === "ArrowRight") {
        const next = shown[viewerIndex + 1]
        if (next) setViewerId(next.id)
      }
      if (event.key === "ArrowLeft") {
        const prev = shown[viewerIndex - 1]
        if (prev) setViewerId(prev.id)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [current, shown, viewerIndex])

  function openAlbum(id: string) {
    setFilter("all")
    setViewerId("")
    setAlbumId(id)
  }

  async function removeAlbum() {
    if (!dropAlbum) return
    setBusy(true)
    setError("")
    try {
      const flag = dropSource ? "?source=1" : ""
      const body = await api<{
        ok: boolean
        sourceDeleted: number
        warnings: string[]
      }>(`/api/media/albums/${encodeURIComponent(dropAlbum.id)}${flag}`, {
        method: "DELETE",
      })
      if (body.warnings?.length) setError(body.warnings.join(" "))
      if (albumId === dropAlbum.id) {
        setAlbumId("")
        setItems([])
        setViewerId("")
      }
      setDropAlbum(null)
      loadAlbums()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "delete failed")
    } finally {
      setBusy(false)
    }
  }

  async function removeItem() {
    if (!dropItem) return
    setBusy(true)
    setError("")
    try {
      const flag = dropSource ? "?source=1" : ""
      const body = await api<{
        ok: boolean
        sourceDeleted: number
        warnings: string[]
      }>(`/api/media/items/${encodeURIComponent(dropItem.id)}${flag}`, {
        method: "DELETE",
      })
      if (body.warnings?.length) setError(body.warnings.join(" "))
      if (viewerId === dropItem.id) {
        const next = shown[viewerIndex + 1] ?? shown[viewerIndex - 1]
        setViewerId(next && next.id !== dropItem.id ? next.id : "")
      }
      setDropItem(null)
      loadAlbums()
      if (albumId) loadItems(albumId)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "delete failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Box
      sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
    >
      <Box className="ob-scroll" sx={{ flex: 1, minHeight: 0, p: 2 }}>
        {error ? (
          <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError("")}>
            {error}
          </Alert>
        ) : null}
        {!albumId ? (
          albums === null ? (
            <CircularProgress />
          ) : albums.length === 0 ? (
            <Typography color="textSecondary">
              No albums yet. Pictures, videos, and 3D models from chat land
              here. The agent can also file other files into a named album.
            </Typography>
          ) : (
            <Stack spacing={1}>
              {albums.map((row) => (
                <Stack
                  key={row.id}
                  direction="row"
                  spacing={1.5}
                  alignItems="center"
                  sx={{
                    p: 1.25,
                    borderRadius: 2,
                    border: 1,
                    borderColor: "divider",
                    "&:hover": { borderColor: "primary.main" },
                  }}
                >
                  {/* The open action is a real button (Enter/Space work, and
                      the delete control stays a sibling, not nested). */}
                  <Box
                    Element="button"
                    type="button"
                    onClick={() => openAlbum(row.id)}
                    aria-label={`Open album ${row.name}`}
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 1.5,
                      flex: 1,
                      minWidth: 0,
                      p: 0,
                      border: "none",
                      background: "transparent",
                      color: "inherit",
                      font: "inherit",
                      textAlign: "left",
                      cursor: "pointer",
                      borderRadius: 1,
                      "&:focus-visible": {
                        outline: "2px solid",
                        outlineColor: "primary.main",
                        outlineOffset: 2,
                      },
                    }}
                  >
                    <Box
                      sx={{
                        width: 56,
                        height: 56,
                        borderRadius: 1.5,
                        overflow: "hidden",
                        flexShrink: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: "action.hover",
                      }}
                    >
                      {row.latest?.kind === "image" ? (
                        <img
                          src={row.latest.url}
                          alt=""
                          style={{
                            width: "100%",
                            height: "100%",
                            objectFit: "cover",
                          }}
                        />
                      ) : (
                        <FolderIcon />
                      )}
                    </Box>
                    <Stack sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ fontWeight: 600 }}>
                        {row.name}
                      </Typography>
                      <Typography variant="caption" color="textSecondary">
                        {row.count} {row.count === 1 ? "item" : "items"}
                        {row.sessionId ? " · thread" : ""}
                      </Typography>
                    </Stack>
                  </Box>
                  <IconButton
                    size="small"
                    aria-label={`Delete ${row.name}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      askDeleteAlbum(row)
                    }}
                  >
                    <DeleteIcon width={18} height={18} />
                  </IconButton>
                </Stack>
              ))}
            </Stack>
          )
        ) : (
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={1} alignItems="center">
              <IconButton
                size="small"
                aria-label="Back to albums"
                onClick={() => {
                  setAlbumId("")
                  setViewerId("")
                }}
              >
                <ArrowBackIcon />
              </IconButton>
              <Typography variant="subtitle1" sx={{ flex: 1, minWidth: 0 }}>
                {album?.name ?? "Album"}
              </Typography>
              <Button
                size="small"
                variant="text"
                startIcon={<DeleteIcon />}
                disabled={!album}
                onClick={() => album && askDeleteAlbum(album)}
              >
                Delete album
              </Button>
            </Stack>
            <Stack
              direction="row"
              spacing={1}
              sx={{ flexWrap: "wrap", rowGap: 1 }}
            >
              {FILTERS.map((entry) => (
                <Chip
                  key={entry.key}
                  size="small"
                  color={filter === entry.key ? "primary" : undefined}
                  onClick={() => {
                    setFilter(entry.key)
                    setViewerId("")
                  }}
                >
                  {entry.label}
                </Chip>
              ))}
            </Stack>
            {shown.length === 0 ? (
              <Typography color="textSecondary">
                Nothing in this view.
              </Typography>
            ) : (
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                  gap: 1,
                }}
              >
                {shown.map((item) => (
                  <Box
                    key={item.id}
                    Element="button"
                    type="button"
                    onClick={() => setViewerId(item.id)}
                    sx={{
                      p: 0,
                      border: 1,
                      borderColor: "divider",
                      borderRadius: 2,
                      overflow: "hidden",
                      cursor: "pointer",
                      background: "transparent",
                      color: "inherit",
                      textAlign: "left",
                    }}
                  >
                    <Box
                      sx={{
                        height: 110,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: "action.hover",
                      }}
                    >
                      {item.kind === "image" ? (
                        <img
                          src={item.url}
                          alt=""
                          style={{
                            width: "100%",
                            height: "100%",
                            objectFit: "cover",
                          }}
                        />
                      ) : (
                        kindIcon(item.kind)
                      )}
                    </Box>
                    <Typography
                      variant="caption"
                      sx={{
                        display: "block",
                        p: 0.75,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {item.title || item.name}
                    </Typography>
                  </Box>
                ))}
              </Box>
            )}
          </Stack>
        )}
      </Box>

      {current ? (
        <Box
          sx={{
            position: "fixed",
            inset: 0,
            zIndex: 1400,
            display: "flex",
            flexDirection: "column",
            backgroundColor: "background.default",
          }}
        >
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            sx={{ px: 1, py: 0.5, flexShrink: 0 }}
          >
            <IconButton
              size="small"
              aria-label="Close viewer"
              onClick={() => setViewerId("")}
            >
              <ArrowBackIcon />
            </IconButton>
            <Typography
              variant="subtitle2"
              sx={{
                flex: 1,
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {current.title || current.name}
            </Typography>
            <Typography variant="caption" color="textSecondary">
              {viewerIndex + 1} / {shown.length}
            </Typography>
            <a
              href={current.url}
              download={current.name}
              aria-label={`Download ${current.name}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                color: "inherit",
              }}
            >
              <DownloadIcon width={18} height={18} />
            </a>
            <IconButton
              size="small"
              aria-label={`Delete ${current.name}`}
              onClick={() => askDeleteItem(current)}
            >
              <DeleteIcon width={18} height={18} />
            </IconButton>
          </Stack>
          <Stack
            direction="row"
            sx={{ flex: 1, minHeight: 0 }}
            alignItems="stretch"
          >
            <IconButton
              aria-label="Previous"
              disabled={viewerIndex <= 0}
              onClick={() => {
                const prev = shown[viewerIndex - 1]
                if (prev) setViewerId(prev.id)
              }}
              sx={{ flexShrink: 0, alignSelf: "center" }}
            >
              <ArrowBackIcon />
            </IconButton>
            <Box
              sx={{
                flex: 1,
                minWidth: 0,
                minHeight: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                p: 1,
              }}
            >
              {current.kind === "image" ? (
                <img
                  src={current.url}
                  alt={current.title}
                  style={{
                    maxWidth: "100%",
                    maxHeight: "100%",
                    objectFit: "contain",
                  }}
                />
              ) : current.kind === "video" ? (
                // biome-ignore lint/a11y/useMediaCaption: generated clips ship without captions
                <video
                  src={current.url}
                  controls
                  style={{ maxWidth: "100%", maxHeight: "100%" }}
                />
              ) : current.kind === "model3d" ? (
                <Box sx={{ width: "100%", height: "100%", minHeight: 280 }}>
                  <Model3dView src={current.url} alt={current.title} />
                </Box>
              ) : (
                <Stack spacing={1} alignItems="center">
                  <DescriptionIcon width={48} height={48} />
                  <Typography>{current.name}</Typography>
                  <Typography variant="caption" color="textSecondary">
                    {formatBytes(current.bytes)}
                  </Typography>
                  <Button
                    variant="contained"
                    startIcon={<DownloadIcon />}
                    onClick={() => {
                      const link = document.createElement("a")
                      link.href = current.url
                      link.download = current.name
                      link.click()
                    }}
                  >
                    Download
                  </Button>
                </Stack>
              )}
            </Box>
            <IconButton
              aria-label="Next"
              disabled={viewerIndex >= shown.length - 1}
              onClick={() => {
                const next = shown[viewerIndex + 1]
                if (next) setViewerId(next.id)
              }}
              sx={{ flexShrink: 0, alignSelf: "center" }}
            >
              <ChevronRightIcon />
            </IconButton>
          </Stack>
        </Box>
      ) : null}

      <Dialog
        open={Boolean(dropAlbum)}
        onClose={() => !busy && setDropAlbum(null)}
      >
        <DialogTitle>Delete album</DialogTitle>
        <DialogContent>
          <Typography>
            Delete {dropAlbum?.name} and its vault copies?
          </Typography>
          <FormControlLabel
            sx={{ mt: 1 }}
            control={
              <CheckBox
                checked={dropSource}
                onChange={(event) => setDropSource(event.currentTarget.checked)}
              />
            }
            label="Also delete the files on the desktop"
          />
          <Typography variant="caption" color="textSecondary" sx={{ mt: 0.5 }}>
            {dropSource
              ? "Frees desktop disk space. Copies are always removed from the vault."
              : "Copies leave the vault; files stay on the desktop."}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setDropAlbum(null)}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={() => void removeAlbum()}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={Boolean(dropItem)}
        onClose={() => !busy && setDropItem(null)}
      >
        <DialogTitle>Delete item</DialogTitle>
        <DialogContent>
          <Typography>Remove this copy from the vault?</Typography>
          <FormControlLabel
            sx={{ mt: 1 }}
            control={
              <CheckBox
                checked={dropSource}
                onChange={(event) => setDropSource(event.currentTarget.checked)}
              />
            }
            label="Also delete the file on the desktop"
          />
          {dropItem?.sourcePath ? (
            <Typography
              variant="caption"
              color="textSecondary"
              sx={{
                mt: 0.5,
                display: "block",
                wordBreak: "break-all",
              }}
            >
              {dropItem.sourcePath}
            </Typography>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setDropItem(null)}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={() => void removeItem()}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
