import Button from "@shpaw415/mui-lite/Button"
import Typography from "@shpaw415/mui-lite/Typography"
import { type PointerEvent, type Ref, useEffect, useState } from "react"
import { ChatMarkdown } from "./chat-markdown"
import { filePreviewKind, truncateTextPreview } from "./file-view"
import { Model3dView } from "./Model3dView"
import Stack from "./stack"

function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1) || path
}

function fileDir(path: string): string {
  const cut = path.lastIndexOf("/")
  return cut > 0 ? path.slice(0, cut) : "/home/agent/workspace"
}

type TextState =
  | { state: "loading" }
  | { state: "ready"; text: string; truncated: boolean }
  | { state: "error" }

/** Fetches a text-ish body (markdown/code/log…) for in-pane rendering. */
function useFileText(src: string, enabled: boolean): TextState {
  const [body, setBody] = useState<TextState>({ state: "loading" })
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    setBody({ state: "loading" })
    void (async () => {
      try {
        const res = await fetch(src)
        if (!res.ok) throw new Error("fetch failed")
        const text = await res.text()
        if (!cancelled)
          setBody({ state: "ready", ...truncateTextPreview(text) })
      } catch {
        if (!cancelled) setBody({ state: "error" })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [src, enabled])
  return body
}

/** One desktop file, rendered for reading: markdown formatted, code and
 * text monospaced, media inline, PDF in the browser viewer, the rest as a
 * download offer. `src` is the served file URL behind `path`. */
export function FilePreviewBody({ path, src }: { path: string; src: string }) {
  const kind = filePreviewKind(path)
  const text = useFileText(src, kind === "markdown" || kind === "text")
  if (kind === "image")
    return (
      <div className="ob-file-body ob-file-center">
        <img src={src} alt={fileName(path)} className="ob-file-media" />
      </div>
    )
  if (kind === "video")
    return (
      <div className="ob-file-body ob-file-center">
        {/* biome-ignore lint/a11y/useMediaCaption: desktop clips ship without captions */}
        <video
          src={src}
          controls
          preload="metadata"
          className="ob-file-media"
        />
      </div>
    )
  if (kind === "audio")
    return (
      <div className="ob-file-body ob-file-center">
        {/* biome-ignore lint/a11y/useMediaCaption: desktop audio ships without captions */}
        <audio src={src} controls preload="metadata" />
      </div>
    )
  if (kind === "pdf")
    return <iframe title={fileName(path)} src={src} className="ob-file-frame" />
  if (kind === "model3d")
    return (
      <div className="ob-file-body">
        <Model3dView src={src} alt={fileName(path)} />
      </div>
    )
  if (kind === "download")
    return (
      <div className="ob-file-body ob-file-center">
        <Typography variant="body2" color="textSecondary">
          This file can't be previewed here.
        </Typography>
        <Button
          size="small"
          variant="contained"
          href={src}
          download={fileName(path)}
        >
          Download {fileName(path)}
        </Button>
      </div>
    )
  if (text.state === "loading")
    return (
      <div className="ob-file-body">
        <Typography variant="body2" color="textSecondary" sx={{ p: 2 }}>
          Opening {fileName(path)}…
        </Typography>
      </div>
    )
  if (text.state === "error")
    return (
      <div className="ob-file-body">
        <Typography variant="body2" color="textSecondary" sx={{ p: 2 }}>
          Could not read this file. It may have moved, or the desktop is asleep.
        </Typography>
      </div>
    )
  return (
    <div className="ob-file-body">
      {kind === "markdown" ? (
        <div className="ob-md ob-file-md">
          <ChatMarkdown text={text.text} basePath={fileDir(path)} />
        </div>
      ) : (
        <pre className="ob-file-pre">{text.text}</pre>
      )}
      {text.truncated ? (
        <Typography variant="caption" color="textSecondary" sx={{ p: 1 }}>
          Preview truncated — download the file to read it all.
        </Typography>
      ) : null}
    </div>
  )
}

function FileBar({
  path,
  src,
  dark,
  onClose,
  onFullscreen,
}: {
  path: string
  src: string
  dark?: boolean
  onClose: () => void
  onFullscreen?: () => void
}) {
  return (
    <Stack
      direction="row"
      spacing={1}
      alignItems="center"
      className="ob-preview-bar"
    >
      <Typography
        variant="caption"
        sx={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          ...(dark ? { color: "#fff" } : {}),
        }}
        title={path}
      >
        {fileName(path)}
      </Typography>
      <Button
        size="small"
        variant={dark ? "contained" : "text"}
        href={src}
        download={fileName(path)}
      >
        Download
      </Button>
      {onFullscreen ? (
        <Button size="small" variant="text" onClick={onFullscreen}>
          Full screen
        </Button>
      ) : null}
      <Button
        size="small"
        variant={dark ? "contained" : "text"}
        onClick={onClose}
      >
        Close
      </Button>
    </Stack>
  )
}

export function FilePreviewPane({
  path,
  src,
  width,
  paneRef,
  onClose,
  onFullscreen,
  onDrag,
}: {
  path: string
  src: string
  width: number
  paneRef: Ref<HTMLDivElement>
  onClose: () => void
  onFullscreen: () => void
  onDrag: (event: PointerEvent<HTMLDivElement>) => void
}) {
  return (
    <>
      <div className="ob-preview-split" onPointerDown={onDrag} />
      <div ref={paneRef} className="ob-preview-pane" style={{ width }}>
        <FileBar
          path={path}
          src={src}
          onClose={onClose}
          onFullscreen={onFullscreen}
        />
        <FilePreviewBody path={path} src={src} />
      </div>
    </>
  )
}

export function FilePreviewOverlay({
  path,
  src,
  onClose,
}: {
  path: string
  src: string
  onClose: () => void
}) {
  return (
    <div className="ob-preview-overlay">
      <FileBar path={path} src={src} dark onClose={onClose} />
      <div className="ob-file-overlay-body">
        <FilePreviewBody path={path} src={src} />
      </div>
    </div>
  )
}
