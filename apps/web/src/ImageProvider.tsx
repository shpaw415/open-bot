import { ImageIcon } from "./icons"
import { MediaProviderForm } from "./MediaProviderForm"

export function ImageProvider({ readOnly = false }: { readOnly?: boolean }) {
  return (
    <MediaProviderForm
      kind="image"
      icon={<ImageIcon />}
      title="Image generation"
      description="Provider used by the desktop agent when it generates images. Pick a provider — only the fields and models it takes are shown. Switching providers keeps the saved key only while the provider stays the same."
      saveLabel="Save image provider"
      noun="image"
      savedApplied="Saved. The desktop agent can generate images now."
      readOnly={readOnly}
    />
  )
}
