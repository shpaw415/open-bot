import Alert from "@shpaw415/mui-lite/Alert"
import Box from "@shpaw415/mui-lite/Box"
import Button from "@shpaw415/mui-lite/Button"
import Paper from "@shpaw415/mui-lite/Paper"
import Select from "@shpaw415/mui-lite/Select"
import Stack from "@shpaw415/mui-lite/Stack"
import Typography from "@shpaw415/mui-lite/Typography"
import { useCallback, useEffect, useMemo, useState } from "react"
import { api, type Me } from "./api"
import { CustomSkills } from "./CustomSkills"
import { ImageProvider } from "./ImageProvider"
import { Personalities } from "./Personalities"
import { System1 } from "./System1"
import { VikingModels } from "./VikingModels"

type Model = { providerID: string; modelID: string; name?: string }

export function Config({ me, onChanged }: { me: Me; onChanged: () => void }) {
  const [models, setModels] = useState<Model[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [selected, setSelected] = useState(
    me.model?.providerID && me.model.modelID
      ? `${me.model.providerID}/${me.model.modelID}`
      : "",
  )
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const loadModels = useCallback(async () => {
    setError("")
    setLoading(true)
    try {
      const body = await api<{ models?: Model[] }>("/api/models")
      setModels(
        (body.models ?? []).filter((item) => item.providerID && item.modelID),
      )
    } catch (caught) {
      setModels([])
      setError(
        caught instanceof Error ? caught.message : "failed to load models",
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadModels()
  }, [loadModels])

  const options = useMemo(
    () =>
      models.map((item) => (
        <option
          key={`${item.providerID}/${item.modelID}`}
          value={`${item.providerID}/${item.modelID}`}
        >
          {item.name
            ? `${item.name} (${item.providerID})`
            : `${item.providerID}/${item.modelID}`}
        </option>
      )),
    [models],
  )

  async function save() {
    setError("")
    setSaved(false)
    const split = selected.indexOf("/")
    const providerID = split > 0 ? selected.slice(0, split) : ""
    const modelID = split > 0 ? selected.slice(split + 1) : ""
    if (!providerID || !modelID) {
      setError("pick a model first")
      return
    }
    setSaving(true)
    try {
      await api("/api/model", {
        method: "PUT",
        body: JSON.stringify({ providerID, modelID }),
      })
      setSaved(true)
      onChanged()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "save failed")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Box className="ob-scroll" sx={{ p: 2, maxWidth: 720, mx: "auto" }}>
      <Typography variant="h6" sx={{ mb: 1 }}>
        Config
      </Typography>
      <Stack spacing={1.5}>
        <Paper variant="outlined" sx={{ p: 1.5 }}>
          <Typography variant="subtitle1">Default chat model</Typography>
          <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
            Preselected for new chat threads and saved as your desktop's default
            model.
          </Typography>
          {error ? <Alert severity="error">{error}</Alert> : null}
          {saved ? (
            <Alert severity="success">
              Saved. New threads will start with this model.
            </Alert>
          ) : null}
          <Stack spacing={1.5} sx={{ mt: 1 }}>
            {loading && models.length === 0 ? (
              <Typography variant="body2" color="textSecondary">
                Loading models — this starts your desktop if it was asleep…
              </Typography>
            ) : (
              <Select
                name="default-model"
                label="Default model"
                value={selected}
                disabled={models.length === 0}
                onSelect={(value) => {
                  setSelected(value)
                  setSaved(false)
                }}
              >
                {options}
              </Select>
            )}
            <Stack direction="row" spacing={1}>
              <Button
                variant="contained"
                disabled={saving || !selected}
                onClick={() => void save()}
              >
                Save default model
              </Button>
              <Button
                variant="text"
                disabled={loading}
                onClick={() => void loadModels()}
              >
                Reload list
              </Button>
            </Stack>
            {!selected && models.length > 0 ? (
              <Typography variant="caption" color="textSecondary">
                No default picked yet — new threads start with an empty model
                picker.
              </Typography>
            ) : null}
          </Stack>
        </Paper>
        <VikingModels endpoint="/api/viking" />
        <System1 />
        <ImageProvider />
        <Personalities />
        <CustomSkills />
      </Stack>
    </Box>
  )
}
