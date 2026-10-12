import Alert from "@shpaw415/mui-lite/Alert"
import Box from "@shpaw415/mui-lite/Box"
import Button from "@shpaw415/mui-lite/Button"
import Select from "@shpaw415/mui-lite/Select"
import Stack from "@shpaw415/mui-lite/Stack"
import Tabs, { Tab } from "@shpaw415/mui-lite/Tabs"
import Typography from "@shpaw415/mui-lite/Typography"
import { useCallback, useEffect, useState } from "react"
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
  MicIcon,
  NavigationIcon,
  PersonIcon,
  PsychologyIcon,
  VpnKeyIcon,
} from "./icons"
import { KeyVault } from "./KeyVault"
import { Model3dProvider } from "./Model3dProvider"
import { ModelSelect } from "./ModelSelect"
import { Personalities } from "./Personalities"
import { System1 } from "./System1"
import { VideoProvider } from "./VideoProvider"
import { VikingModels } from "./VikingModels"
import { VoiceProvider } from "./VoiceProvider"

type Model = {
  providerID: string
  modelID: string
  name?: string
  variants?: string[]
}

type ConfigTab =
  | "keys"
  | "chat"
  | "memory"
  | "nav"
  | "media"
  | "voice"
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
          <ModelSelect
            name="default-model"
            label="Default model"
            models={models}
            value={selected}
            disabled={models.length === 0}
            userId={me.id}
            onSelect={(value) => {
              setSelected(value)
              setSaved(false)
            }}
          />
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

const EFFORT_LABELS: Record<string, string> = {
  none: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
  thinking: "Thinking on",
}

function effortLabel(variant: string): string {
  return (
    EFFORT_LABELS[variant] ?? variant.charAt(0).toUpperCase() + variant.slice(1)
  )
}

function ThinkingEffortSection({
  me,
  onChanged,
}: {
  me: Me
  onChanged: () => void
}) {
  const [models, setModels] = useState<Model[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [effort, setEffort] = useState(me.model?.thinkingEffort ?? "")
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

  // A default-model change can drop an effort the new model does not support;
  // follow the server value when it moves.
  useEffect(() => {
    setEffort(me.model?.thinkingEffort ?? "")
  }, [me.model?.thinkingEffort])

  const selectedKey =
    me.model?.providerID && me.model.modelID
      ? `${me.model.providerID}/${me.model.modelID}`
      : ""
  const variants =
    models.find((item) => `${item.providerID}/${item.modelID}` === selectedKey)
      ?.variants ?? []
  const options =
    effort && !variants.includes(effort) ? [...variants, effort] : variants

  async function save() {
    setError("")
    setSaved(false)
    setSaving(true)
    try {
      await api("/api/thinking", {
        method: "PUT",
        body: JSON.stringify({ effort }),
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
    <ConfigSection
      icon={<PsychologyIcon />}
      title="Thinking effort"
      description="How much reasoning the model puts into each reply. The options come from the default model's supported variants."
      status={
        effort
          ? { label: effortLabel(effort), color: "primary" }
          : variants.length > 0
            ? { label: "Model default" }
            : null
      }
    >
      <Stack spacing={1.5}>
        {error ? <Alert severity="error">{error}</Alert> : null}
        {saved ? (
          <Alert severity="success">
            Saved. The next message in every thread uses this effort.
          </Alert>
        ) : null}
        {!selectedKey ? (
          <Typography variant="body2" color="textSecondary">
            Pick a default model first — its supported thinking levels show up
            here.
          </Typography>
        ) : loading && models.length === 0 ? (
          <Typography variant="body2" color="textSecondary">
            Loading models — this starts your desktop if it was asleep…
          </Typography>
        ) : options.length === 0 ? (
          <Typography variant="body2" color="textSecondary">
            This model has no thinking variants.
          </Typography>
        ) : (
          <Select
            name="thinking-effort"
            label="Thinking effort"
            value={effort}
            onSelect={(value: string) => {
              setEffort(value)
              setSaved(false)
            }}
          >
            {["", ...options].map((variant) => (
              <option key={variant} value={variant}>
                {variant === "" ? "Model default" : effortLabel(variant)}
              </option>
            ))}
          </Select>
        )}
        <Stack direction="row" spacing={1}>
          <Button
            variant="contained"
            disabled={saving || !selectedKey || options.length === 0}
            onClick={() => void save()}
          >
            Save thinking effort
          </Button>
          <Button
            variant="text"
            disabled={loading}
            onClick={() => void loadModels()}
          >
            Reload list
          </Button>
        </Stack>
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
          <Tab label="Voice" value="voice" icon={<MicIcon />} />
          <Tab label="Personas" value="personas" icon={<PersonIcon />} />
          <Tab label="Skills" value="skills" icon={<ExtensionIcon />} />
          <Tab label="Backup" value="backup" icon={<BackupIcon />} />
        </Tabs>
        {tab === "keys" ? <KeyVault /> : null}
        {tab === "chat" ? (
          <>
            <DefaultModelSection me={me} onChanged={onChanged} />
            <ThinkingEffortSection me={me} onChanged={onChanged} />
          </>
        ) : null}
        {tab === "memory" ? <VikingModels endpoint="/api/viking" /> : null}
        {tab === "nav" ? <System1 /> : null}
        {tab === "media" ? <ImageProvider /> : null}
        {tab === "media" ? <VideoProvider /> : null}
        {tab === "media" ? <Model3dProvider /> : null}
        {tab === "voice" ? <VoiceProvider /> : null}
        {tab === "personas" ? <Personalities /> : null}
        {tab === "skills" ? <CustomSkills /> : null}
        {tab === "backup" ? <Backup me={me} /> : null}
      </Stack>
    </Box>
  )
}
