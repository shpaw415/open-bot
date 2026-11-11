import Alert from "@shpaw415/mui-lite/Alert"
import Button from "@shpaw415/mui-lite/Button"
import Select from "@shpaw415/mui-lite/Select"
import Typography from "@shpaw415/mui-lite/Typography"
import { useEffect, useState } from "react"
import { api } from "../api"
import Stack from "../stack"

export type TeamChatFieldsProps = {
  // The `chat` overlay draft (flat provider/model fields).
  values: Record<string, string>
  onChange: (field: string, value: string) => void
}

export type OpencodeChatModel = {
  providerID: string
  modelID: string
  name?: string
}

/** Connected OpenCode provider ids, in the order /api/models returns them. */
export function chatProviderIds(
  models: readonly OpencodeChatModel[],
): string[] {
  return [...new Set(models.map((model) => model.providerID))]
}

/** The models one OpenCode provider offers — the model list follows it. */
export function chatModelsForProvider(
  models: readonly OpencodeChatModel[],
  providerID: string,
): OpencodeChatModel[] {
  return models.filter((model) => model.providerID === providerID)
}

// The shared chat default. Unlike the other overlay sections it has no
// static catalog: the provider is picked from the admin desktop's live
// OpenCode setup (GET /api/models — the connected providers only, the same
// list the chat model picker and the OpenViking VLM picker read), and the
// model select lists exactly that provider's models. In team mode the
// admin's OpenCode auth is the shared snapshot every desktop merges, so a
// provider/model picked here exists on everyone's desktop.
export function TeamChatFields({ values, onChange }: TeamChatFieldsProps) {
  const providerId = values.provider ?? ""
  const model = values.model ?? ""
  // null = not loaded yet; the fetch effect below (and Reload) key off it.
  const [models, setModels] = useState<OpencodeChatModel[] | null>(null)
  const [modelsError, setModelsError] = useState("")

  // /api/models reads the desktop's live provider list, so it starts a
  // sleeping desktop like every other model picker. A failure keeps the
  // saved pick visible below instead of blanking the section.
  useEffect(() => {
    if (models !== null) return
    let alive = true
    setModelsError("")
    void api<{ models?: OpencodeChatModel[] }>("/api/models")
      .then((body) => {
        if (alive)
          setModels(
            (body.models ?? []).filter(
              (item) => item.providerID && item.modelID,
            ),
          )
      })
      .catch((caught: unknown) => {
        if (alive) {
          setModels([])
          setModelsError(
            caught instanceof Error ? caught.message : "model list failed",
          )
        }
      })
    return () => {
      alive = false
    }
  }, [models])

  const loaded = models !== null
  const all = models ?? []
  const providerIds = chatProviderIds(all)
  const providerModels = chatModelsForProvider(all, providerId)
  const providerKnown = providerId === "" || providerIds.includes(providerId)
  const modelKnown =
    model === "" || providerModels.some((item) => item.modelID === model)

  function pickProvider(id: string) {
    onChange("provider", id)
    // The previous provider's model id is meaningless under the new one:
    // take its first model (blank when clearing or it offers none).
    onChange("model", chatModelsForProvider(all, id)[0]?.modelID ?? "")
  }

  return (
    <Stack spacing={0.5} sx={{ mt: 0.5 }}>
      <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ rowGap: 1 }}>
        <Select
          name="team-chat-provider"
          label="OpenCode provider"
          value={providerId}
          sx={{ width: 240 }}
          disabled={!loaded}
          onSelect={pickProvider}
        >
          {[
            <option key="none" value="">
              Not set
            </option>,
            ...(providerKnown
              ? []
              : [
                  <option key={providerId} value={providerId}>
                    {loaded ? `${providerId} (not connected)` : providerId}
                  </option>,
                ]),
            ...providerIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            )),
          ]}
        </Select>
        <Select
          name="team-chat-model"
          label="Model"
          value={model}
          sx={{ width: 240 }}
          disabled={!loaded || !providerId}
          onSelect={(id: string) => onChange("model", id)}
        >
          {[
            <option key="none" value="">
              Not set
            </option>,
            ...(modelKnown
              ? []
              : [
                  <option key={model} value={model}>
                    {loaded ? `${model} (not in OpenCode setup)` : model}
                  </option>,
                ]),
            ...providerModels.map((item) => (
              <option key={item.modelID} value={item.modelID}>
                {item.name ? `${item.name} (${item.modelID})` : item.modelID}
              </option>
            )),
          ]}
        </Select>
        <Button
          variant="text"
          disabled={!loaded}
          onClick={() => setModels(null)}
        >
          Reload list
        </Button>
      </Stack>
      {modelsError ? (
        <Alert severity="error">
          Could not load the OpenCode model list ({modelsError}). The saved
          provider and model above are kept.
        </Alert>
      ) : null}
      <Typography variant="caption" color="textSecondary">
        {!loaded
          ? "Loading your desktop's OpenCode models — this starts the desktop if it is asleep."
          : providerIds.length === 0 && !modelsError
            ? "No OpenCode provider is connected on your desktop yet — connect one on the Providers page, then reload the list."
            : "Providers and models come from your desktop's OpenCode setup — connect providers on the Providers page."}
      </Typography>
    </Stack>
  )
}
