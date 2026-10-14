import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { CloseIcon, DownloadIcon, FullscreenIcon } from "./icons"

export function downloadName(src: string): string {
  try {
    const url = new URL(src, window.location.origin)
    const path = url.searchParams.get("path") ?? url.pathname
    const name = decodeURIComponent(path.split("/").pop() ?? "")
    return name || "download"
  } catch {
    return "download"
  }
}

/**
 * Hover download button for chat media (images, 3D models). The href must be
 * same-origin so the `download` attribute forces a file save instead of a
 * navigation.
 */
export function MediaDownloadButton({ src }: { src: string }) {
  return (
    <a
      className="ob-dl-btn"
      href={src}
      download={downloadName(src)}
      title={`Download ${downloadName(src)}`}
      aria-label={`Download ${downloadName(src)}`}
    >
      <DownloadIcon width={16} height={16} />
    </a>
  )
}

function isVideoSrc(src: string): boolean {
  return /\.(mp4|webm)$/i.test(src)
}

/**
 * Hover fullscreen button for chat media. Opens the image or clip in a
 * full-viewport lightbox over a dark backdrop; clicking the backdrop, the X
 * button, or pressing Escape closes it.
 */
export function MediaFullscreenButton({
  src,
  alt = "",
}: {
  src: string
  alt?: string
}) {
  const [open, setOpen] = useState(false)
  const video = isVideoSrc(src)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    window.addEventListener("keydown", onKey)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      window.removeEventListener("keydown", onKey)
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  return (
    <>
      <button
        type="button"
        className="ob-dl-btn ob-fs-btn"
        onClick={() => setOpen(true)}
        title="View full screen"
        aria-label="View full screen"
      >
        <FullscreenIcon width={16} height={16} />
      </button>
      {open
        ? createPortal(
            <div
              className="ob-lightbox"
              role="dialog"
              aria-modal="true"
              aria-label="Full screen media"
              onClick={(event) => {
                if (event.target === event.currentTarget) setOpen(false)
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") setOpen(false)
              }}
            >
              <button
                type="button"
                className="ob-lightbox-close"
                onClick={() => setOpen(false)}
                title="Close full screen"
                aria-label="Close full screen"
              >
                <CloseIcon width={20} height={20} />
              </button>
              {video ? (
                // biome-ignore lint/a11y/useMediaCaption: generated clips ship without captions
                <video src={src} controls autoPlay />
              ) : (
                <img src={src} alt={alt} />
              )}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
