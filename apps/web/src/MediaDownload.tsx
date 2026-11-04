import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useBackLayer } from "./back-nav"
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
 * Full-viewport media lightbox. It is a real history layer: opening pushes
 * one entry, so the system/browser Back button (and Forward) closes and
 * reopens it like a native photo viewer; backdrop tap, ✕ and Escape take
 * the same close path and consume that entry.
 */
function useLightbox() {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const reopen = useCallback(() => setOpen(true), [])
  useBackLayer(open, close, { name: "lightbox", reopen })

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

  return { open, setOpen, close }
}

function LightboxPortal({
  src,
  alt,
  onClose,
}: {
  src: string
  alt: string
  onClose: () => void
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const video = isVideoSrc(src)
  // The full-screen copy is a fresh load (workspace/media URLs are
  // no-store and proxied through the desktop), so it can lag or fail
  // after the thumbnail already painted. Track it: a pending or broken
  // image must never read as a silent black screen with only the ✕.
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    video ? "ready" : "loading",
  )
  const [attempt, setAttempt] = useState(0)
  const imgRef = useRef<HTMLImageElement | null>(null)
  useEffect(() => {
    closeRef.current?.focus()
  }, [])
  // biome-ignore lint/correctness/useExhaustiveDependencies: src/attempt are retrigger keys — the body re-checks the remounted img element
  useEffect(() => {
    if (video) return
    setStatus("loading")
    // A cached image can complete before React's load handler attaches;
    // settle from the element itself so the status cannot stick.
    const img = imgRef.current
    if (img?.complete) setStatus(img.naturalWidth > 0 ? "ready" : "error")
  }, [src, attempt, video])
  return createPortal(
    <div
      className="ob-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="Full screen media"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose()
      }}
    >
      <button
        ref={closeRef}
        type="button"
        className="ob-lightbox-close"
        onClick={onClose}
        title="Close full screen"
        aria-label="Close full screen"
      >
        <CloseIcon width={20} height={20} />
      </button>
      {video ? (
        // biome-ignore lint/a11y/useMediaCaption: generated clips ship without captions
        <video src={src} controls autoPlay />
      ) : status === "error" ? null : (
        <img
          key={`${src}:${attempt}`}
          ref={imgRef}
          src={src}
          alt={alt}
          onLoad={() => setStatus("ready")}
          onError={() => setStatus("error")}
        />
      )}
      {video || status === "ready" ? null : (
        <div className="ob-lightbox-status">
          {status === "error" ? (
            <div className="ob-lightbox-error" role="alert">
              <span>This image could not be loaded.</span>
              <span className="ob-lightbox-error-actions">
                <button
                  type="button"
                  className="ob-lightbox-action"
                  onClick={() => setAttempt((n) => n + 1)}
                >
                  Retry
                </button>
                <a
                  className="ob-lightbox-action"
                  href={src}
                  download={downloadName(src)}
                >
                  Download
                </a>
              </span>
            </div>
          ) : (
            <output>Loading…</output>
          )}
        </div>
      )}
    </div>,
    document.body,
  )
}

export function MediaFullscreenButton({
  src,
  alt = "",
}: {
  src: string
  alt?: string
}) {
  const { open, setOpen, close } = useLightbox()
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
      {open ? <LightboxPortal src={src} alt={alt} onClose={close} /> : null}
    </>
  )
}

/**
 * An image rendered as a real button that opens the same full-screen
 * lightbox (keyboard, Escape and Back included). The caller styles the
 * button box; the image fills it. Used where the preview itself is the
 * control and needs its own label, e.g. composer attachment tiles.
 */
export function LightboxImageButton({
  src,
  alt = "",
  label,
  className,
}: {
  src: string
  alt?: string
  label: string
  className?: string
}) {
  const { open, setOpen, close } = useLightbox()
  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => setOpen(true)}
        title={label}
        aria-label={label}
      >
        <img src={src} alt="" />
      </button>
      {open ? <LightboxPortal src={src} alt={alt} onClose={close} /> : null}
    </>
  )
}

/**
 * Chat image with app-style tap behavior: tapping the image itself opens
 * the lightbox (hover buttons do not exist on touch screens); download
 * and fullscreen buttons ride along for pointer users.
 */
export function MediaImage({ src, alt = "" }: { src: string; alt?: string }) {
  const { open, setOpen, close } = useLightbox()
  return (
    <span className="ob-media-wrap">
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the adjacent fullscreen button is the keyboard path to the same lightbox */}
      <img
        src={src}
        alt={alt}
        className="ob-media-tap"
        onClick={() => setOpen(true)}
      />
      <MediaDownloadButton src={src} />
      <button
        type="button"
        className="ob-dl-btn ob-fs-btn"
        onClick={() => setOpen(true)}
        title="View full screen"
        aria-label="View full screen"
      >
        <FullscreenIcon width={16} height={16} />
      </button>
      {open ? <LightboxPortal src={src} alt={alt} onClose={close} /> : null}
    </span>
  )
}
