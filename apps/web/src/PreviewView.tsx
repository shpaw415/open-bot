import Button from "@shpaw415/mui-lite/Button"
import Stack from "@shpaw415/mui-lite/Stack"
import Typography from "@shpaw415/mui-lite/Typography"
import type { PointerEvent, Ref } from "react"

export function PreviewFrame({ src, title }: { src: string; title: string }) {
  return (
    <iframe
      title={title}
      src={src}
      sandbox="allow-scripts allow-forms allow-popups allow-modals"
      referrerPolicy="no-referrer"
    />
  )
}

export function PreviewEmbed({
  src,
  onOpen,
}: {
  src: string
  onOpen: () => void
}) {
  return (
    <div className="ob-preview">
      <PreviewFrame src={src} title="preview" />
      <div className="ob-preview-open">
        <Button size="small" variant="contained" onClick={onOpen}>
          Open
        </Button>
      </div>
    </div>
  )
}

export function PreviewPane({
  src,
  width,
  paneRef,
  onClose,
  onFullscreen,
  onDrag,
}: {
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
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          className="ob-preview-bar"
        >
          <Typography variant="caption" sx={{ flex: 1 }}>
            Preview
          </Typography>
          <Button size="small" variant="text" onClick={onFullscreen}>
            Full screen
          </Button>
          <Button size="small" variant="text" onClick={onClose}>
            Close
          </Button>
        </Stack>
        <PreviewFrame src={src} title="preview" />
      </div>
    </>
  )
}

export function PreviewOverlay({
  src,
  onClose,
}: {
  src: string
  onClose: () => void
}) {
  return (
    <div className="ob-preview-overlay">
      <Stack direction="row" spacing={1} alignItems="center">
        <Typography variant="caption" sx={{ flex: 1, color: "#fff" }}>
          Preview
        </Typography>
        <Button size="small" variant="contained" onClick={onClose}>
          Close
        </Button>
      </Stack>
      <PreviewFrame src={src} title="preview" />
    </div>
  )
}

export function clampPreviewWidth(width: number, parentWidth: number) {
  const reserved = 520
  const max = Math.max(
    280,
    Math.min(Math.floor(parentWidth * 0.7), parentWidth - reserved),
  )
  const min = Math.min(320, max)
  return Math.min(max, Math.max(min, Math.round(width)))
}
