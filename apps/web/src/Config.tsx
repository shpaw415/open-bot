import Alert from "@shpaw415/mui-lite/Alert"
import Box from "@shpaw415/mui-lite/Box"
import Button from "@shpaw415/mui-lite/Button"
import Select from "@shpaw415/mui-lite/Select"
import Stack from "@shpaw415/mui-lite/Stack"
import Tabs, { Tab } from "@shpaw415/mui-lite/Tabs"
import Typography from "@shpaw415/mui-lite/Typography"
import { useCallback, useEffect, useMemo, useState } from "react"
import { api, type Me } from "./api"
import { Backup } from "./Backup"
import { ConfigSection } from "./ConfigSection"
import { CustomSkills } from "./CustomSkills"
import { useMobile } from "./hooks"
import { ImageProvider } from "./ImageProvider"
import {
  BackupIcon,
  ChatIcon,
  ExtensionIcon,
  ImageIcon,
  MemoryIcon,
  NavigationIcon,
  PersonIcon,
  VpnKeyIcon,
} from "./icons"
import { KeyVault } from "./KeyVault"
import { Model3dProvider } from "./Model3dProvider"
import { Personalities } from "./Personalities"
import { System1 } from "./System1"
import { VideoProvider } from "./VideoProvider"
import { VikingModels } from "./VikingModels"

type Model = { providerID: string; modelID: string; name?: string }

type ConfigTab =
  | "keys"
  | "chat"
  | "memory"
  | "nav"
  | "media"
  | "personas"
  | "skills"
  | "backup"

function DefaultModelSection({
  me,
  onChanged,
}: {
  me: Me
  onChanged: () => void
}) {
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

  const shortLabel = selected ? (selected.split("/").pop() ?? selected) : ""

  return (
    <ConfigSection
      icon={<ChatIcon />}
      title="Default chat model"
      description="Preselected for new chat threads and saved as your desktop's default model."
      status={
        selected
          ? { label: shortLabel, color: "primary" }
          : models.length > 0
            ? { label: "Not set" }
            : null
      }
    >
      <Stack spacing={1.5}>
        {error ? <Alert severity="error">{error}</Alert> : null}
        {saved ? (
          <Alert severity="success">
            Saved. New threads will start with this model.
          </Alert>
        ) : null}
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
    </ConfigSection>
  )
}

export function Config({ me, onChanged }: { me: Me; onChanged: () => void }) {
  const [tab, setTab] = useState<ConfigTab>("chat")
  const mobile = useMobile()

  return (
    <Box className="ob-scroll">
      <Stack
        spacing={2}
        sx={{
          p: mobile ? 1 : 2,
          maxWidth: 1024,
          mx: "auto",
          width: "100%",
        }}
      >
        <Stack spacing={0.25}>
          <Typography variant="h6">Configuration</Typography>
          <Typography variant="body2" color="textSecondary">
            Shared provider keys, chat defaults, memory, navigation, media,
            personas, and skills for this desktop. Chat models themselves are
            connected on the Providers page.
          </Typography>
        </Stack>
        <Tabs
          value={tab}
          variant="scrollable"
          onChange={(_event, value) => setTab(value as ConfigTab)}
        >
          <Tab label="Keys" value="keys" icon={<VpnKeyIcon />} />
          <Tab label="Chat" value="chat" icon={<ChatIcon />} />
          <Tab label="Memory" value="memory" icon={<MemoryIcon />} />
          <Tab label="Navigation" value="nav" icon={<NavigationIcon />} />
          <Tab label="Media" value="media" icon={<ImageIcon />} />
          <Tab label="Personas" value="personas" icon={<PersonIcon />} />
          <Tab label="Skills" value="skills" icon={<ExtensionIcon />} />
          <Tab label="Backup" value="backup" icon={<BackupIcon />} />
        </Tabs>
        {tab === "keys" ? <KeyVault /> : null}
        {tab === "chat" ? (
          <DefaultModelSection me={me} onChanged={onChanged} />
        ) : null}
        {tab === "memory" ? <VikingModels endpoint="/api/viking" /> : null}
        {tab === "nav" ? <System1 /> : null}
        {tab === "media" ? <ImageProvider /> : null}
        {tab === "media" ? <VideoProvider /> : null}
        {tab === "media" ? <Model3dProvider /> : null}
        {tab === "personas" ? <Personalities /> : null}
        {tab === "skills" ? <CustomSkills /> : null}
        {tab === "backup" ? <Backup me={me} /> : null}
      </Stack>
    </Box>
  )
}
