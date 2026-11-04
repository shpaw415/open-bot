import { CloseIcon } from "./icons"
import { type JoinedFile, joinedImage } from "./join-file"
import { LightboxImageButton } from "./MediaDownload"
import { THREADS_UI } from "./texts"

// Files attached to the not-yet-sent composer message (pasted, dropped or
// picked). Images get a real preview tile — large enough to verify the
// pasted screenshot before sending, uncropped (contain), tap/click opens
// the full-screen lightbox, name + format/size stay visible, and remove
// is a labelled button. Other files keep a compact named pill.

function joinedMeta(file: JoinedFile): string {
  const format = file.mime.split("/").pop()?.toUpperCase() ?? ""
  const payload = file.url.split(",").pop() ?? ""
  if (!payload) return format
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0
  const bytes = Math.max(0, Math.floor((payload.length * 3) / 4) - padding)
  const size =
    bytes < 1024
      ? `${bytes} o`
      : bytes < 1024 * 1024
        ? `${Math.round(bytes / 1024)} Ko`
        : `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} Mo`
  return format ? `${format} · ${size}` : size
}

function RemoveButton({
  name,
  className,
  onRemove,
}: {
  name: string
  className: string
  onRemove: () => void
}) {
  const label = THREADS_UI.removeJoined(name)
  return (
    <button
      type="button"
      className={className}
      title={label}
      aria-label={label}
      onClick={onRemove}
    >
      <CloseIcon width={16} height={16} />
    </button>
  )
}

export function JoinedFiles({
  files,
  onRemove,
}: {
  files: JoinedFile[]
  onRemove: (id: string) => void
}) {
  if (files.length === 0) return null
  return (
    <ul className="ob-join-files" aria-label={THREADS_UI.joinedFiles}>
      {files.map((file) =>
        joinedImage(file) ? (
          <li key={file.id}>
            <figure className="ob-join-preview">
              <LightboxImageButton
                src={file.url}
                alt={file.name}
                label={THREADS_UI.previewJoined(file.name)}
                className="ob-join-preview-button"
              />
              <RemoveButton
                name={file.name}
                className="ob-join-preview-remove"
                onRemove={() => onRemove(file.id)}
              />
              <figcaption className="ob-join-preview-caption">
                <span className="ob-join-preview-name" title={file.name}>
                  {file.name}
                </span>
                <span className="ob-join-preview-meta">{joinedMeta(file)}</span>
              </figcaption>
            </figure>
          </li>
        ) : (
          <li key={file.id} className="ob-join-file">
            <span className="ob-join-file-name" title={file.name}>
              {file.name}
            </span>
            <RemoveButton
              name={file.name}
              className="ob-join-file-remove"
              onRemove={() => onRemove(file.id)}
            />
          </li>
        ),
      )}
    </ul>
  )
}
