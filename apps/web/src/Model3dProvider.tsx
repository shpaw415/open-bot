import { Model3dIcon } from "./icons"
import { MediaProviderForm } from "./MediaProviderForm"

export function Model3dProvider({ readOnly = false }: { readOnly?: boolean }) {
  return (
    <MediaProviderForm
      kind="model3d"
      icon={<Model3dIcon />}
      title="3D model generation"
      description="Provider used by the desktop agent when it generates 3D models. Without a provider the agent falls back to building printable parts procedurally with gpio-3d. Pick a provider — only the fields and models it takes are shown. Switching providers keeps the saved key only while the provider stays the same."
      saveLabel="Save 3D provider"
      noun="3D"
      savedApplied="Saved. The desktop agent can generate 3D models now."
      readOnly={readOnly}
    />
  )
}
