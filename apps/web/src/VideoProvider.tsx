import { VideoIcon } from "./icons"
import { MediaProviderForm } from "./MediaProviderForm"

export function VideoProvider({ readOnly = false }: { readOnly?: boolean }) {
  return (
    <MediaProviderForm
      kind="video"
      icon={<VideoIcon />}
      title="Video generation"
      description="Provider used by the desktop agent when it generates videos. Pick a provider — only the fields and models it takes are shown. Switching providers keeps the saved key only while the provider stays the same."
      saveLabel="Save video provider"
      noun="video"
      savedApplied="Saved. The desktop agent can generate videos now."
      readOnly={readOnly}
    />
  )
}
