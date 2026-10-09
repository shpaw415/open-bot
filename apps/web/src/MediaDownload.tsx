import { DownloadIcon } from "./icons"

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
