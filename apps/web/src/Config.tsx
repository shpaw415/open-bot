import Alert from "@shpaw415/mui-lite/Alert"
import Box from "@shpaw415/mui-lite/Box"
import Button from "@shpaw415/mui-lite/Button"
import IconButton from "@shpaw415/mui-lite/IconButton"
import Select from "@shpaw415/mui-lite/Select"
import Stack from "@shpaw415/mui-lite/Stack"
import Typography from "@shpaw415/mui-lite/Typography"
import { useCallback, useEffect, useRef, useState } from "react"
import { api, type Me } from "./api"
import { Backup } from "./Backup"
import { ConfigSection } from "./ConfigSection"
import { CustomSkills } from "./CustomSkills"
import { Chip } from "./chip"
import { useDirtyForm } from "./dirty-form"
import { Endpoints } from "./Endpoints"
import { Hardware } from "./Hardware"
import { useMobile } from "./hooks"
import { ImageProvider } from "./ImageProvider"
import {
  ArrowBackIcon,
  BackupIcon,
  BugReportIcon,
  ChatIcon,
  ComputerIcon,
  ExtensionIcon,
  HubIcon,
  ImageIcon,
  KeyIcon,
  MemoryIcon,
  MicIcon,
  NavigationIcon,
  PersonIcon,
  PsychologyIcon,
  PublicIcon,
  ScheduleIcon,
  SecurityIcon,
  VpnKeyIcon,
} from "./icons"
import { KeyVault } from "./KeyVault"
import { McpView } from "./McpView"
import { Model3dProvider } from "./Model3dProvider"
import { ModelSelect } from "./ModelSelect"
import { Personalities } from "./Personalities"
import { Plugins } from "./Plugins"
import { Providers } from "./Providers"
import { Reports } from "./Reports"
import { CONFIG_GROUPS, CONFIG_TAB_LABELS, type ConfigTab } from "./routes"
import { System1 } from "./System1"
import { useTeamMode } from "./team"
import { QuotaMeter } from "./team-quota"
import { VideoProvider } from "./VideoProvider"
import { VikingModels } from "./VikingModels"
import { VoiceProvider } from "./VoiceProvider"
import { Watchdog } from "./Watchdog"

type Model = {
  providerID: string
  modelID: string
  name?: string
  variants?: string[]
}

const TAB_ICONS: Record<ConfigTab, React.ReactNode> = {
  providers: <VpnKeyIcon />,
  keys: <KeyIcon />,
  chat: <ChatIcon />,
  memory: <MemoryIcon />,
  nav: <NavigationIcon />,
  media: <ImageIcon />,
  voice: <MicIcon />,
  personas: <PersonIcon />,
  skills: <ExtensionIcon />,
  plugins: <ExtensionIcon />,
  mcp: <HubIcon />,
  endpoints: <PublicIcon />,
  backup: <BackupIcon />,
  hardware: <ComputerIcon />,
  reports: <BugReportIcon />,
  security: <SecurityIcon />,
}

/** One short line per section — what it decides, not an app inventory. */
const TAB_DESCRIPTIONS: Record<ConfigTab, string> = {
  providers: "Which model providers this desktop can use.",
  keys: "Shared provider keys and per-plugin vault keys.",
  chat: "Default model and how much the model reasons per reply.",
  memory: "Embedding and language models behind agent memory.",
  nav: "The fast decision model the agent uses to steer the browser.",
  media: "Image, video, and 3D generation providers.",
  voice: "Speech-to-text and read-aloud for the chat composer.",
  personas: "Personalities threads can start with.",
  skills: "Extra instruction packs the agent can load.",
  plugins: "Installed plugins, the marketplace, and install policy.",
  mcp: "MCP servers the desktop's opencode connects to.",
  endpoints: "Public URLs that reach plugin page servers.",
  backup: "Snapshots and restores for this instance.",
  hardware: "Disk, memory, and CPU of the desktop container.",
  reports: "Bug and friction findings the desktop agent files.",
  security: "The watchdog that monitors model exchanges.",
}

function DefaultModelSection({
  me,
  onChanged,
  locked,
}: {
  me: Me
  onChanged: () => void
  locked: boolean
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
  const [dirty, setDirty] = useDirtyForm()
  const dirtyRef = useRef(false)

  // Both flags stay in sync: the ref for the unload guard below, the
  // registry for the shell's internal-navigation guard.
  const markDirty = useCallback(
    (next: boolean) => {
      dirtyRef.current = next
      setDirty(next)
    },
    [setDirty],
  )

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

  // Tab close/refresh guard; in-app navigation is covered by the
  // useDirtyForm registry the shell consults on pushState/popstate.
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return
      event.preventDefault()
    }
    window.addEventListener("beforeunload", guard)
    return () => window.removeEventListener("beforeunload", guard)
  }, [])

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
      markDirty(false)
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
      description={
        locked
          ? "Set by your admin — the host's team mode picks this model for everyone."
          : "Preselected for new chat threads and saved as your desktop's default model."
      }
      status={
        locked
          ? { label: "Locked", color: "warning" }
          : selected
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
          <Stack spacing={1} aria-busy="true">
            <Box className="ob-skeleton" sx={{ height: 40 }} />
            <output className="ob-sr-status">Loading models</output>
          </Stack>
        ) : (
          <ModelSelect
            name="default-model"
            label="Default model"
            models={models}
            value={selected}
            disabled={models.length === 0 || locked}
            userId={me.id}
            onSelect={(value) => {
              setSelected(value)
              setSaved(false)
              markDirty(true)
            }}
          />
        )}
        {locked ? (
          <Typography variant="caption" color="textSecondary">
            Set by your admin — the team's shared chat model applies to
            everyone.
          </Typography>
        ) : (
          <Stack direction="row" spacing={1}>
            <Button
              variant="contained"
              disabled={saving || !selected}
              onClick={() => void save()}
            >
              {saving ? "Saving…" : "Save default model"}
            </Button>
            {dirty && !saving ? (
              <Chip size="small" variant="outlined" color="warning">
                unsaved
              </Chip>
            ) : null}
            <Button
              variant="text"
              disabled={loading}
              onClick={() => void loadModels()}
            >
              Reload list
            </Button>
          </Stack>
        )}
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
  const [effortDirty, setEffortDirty] = useDirtyForm()
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
      setEffortDirty(false)
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
          <Stack spacing={1} aria-busy="true">
            <Box className="ob-skeleton" sx={{ height: 40 }} />
            <output className="ob-sr-status">Loading models</output>
          </Stack>
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
              setEffortDirty(true)
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
            {saving ? "Saving…" : "Save thinking effort"}
          </Button>
          {effortDirty && !saving ? (
            <Chip size="small" variant="outlined" color="warning">
              unsaved
            </Chip>
          ) : null}
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

function renderSection(
  tab: ConfigTab,
  me: Me,
  onChanged: () => void,
  readOnly: boolean,
  lockedModel: boolean,
) {
  switch (tab) {
    case "providers":
      return <Providers />
    case "keys":
      return (
        <>
          <QuotaMeter />
          <KeyVault isAdmin={me.role === "admin"} />
        </>
      )
    case "chat":
      return (
        <>
          <DefaultModelSection
            me={me}
            onChanged={onChanged}
            locked={lockedModel}
          />
          <ThinkingEffortSection me={me} onChanged={onChanged} />
        </>
      )
    case "memory":
      return <VikingModels endpoint="/api/viking" />
    case "nav":
      return <System1 />
    case "media":
      return (
        <>
          <ImageProvider readOnly={readOnly} />
          <VideoProvider readOnly={readOnly} />
          <Model3dProvider readOnly={readOnly} />
        </>
      )
    case "voice":
      return <VoiceProvider />
    case "personas":
      return <Personalities />
    case "skills":
      return <CustomSkills />
    case "backup":
      return <Backup me={me} />
    case "plugins":
      return <Plugins isAdmin={me.role === "admin"} />
    case "mcp":
      return <McpView />
    case "endpoints":
      return <Endpoints />
    case "hardware":
      return <Hardware />
    case "reports":
      return <Reports />
    case "security":
      return <Watchdog />
  }
}

export function Config({
  me,
  tab,
  onTab,
  onChanged,
}: {
  me: Me
  /** Active section from the URL; "" only on the mobile group list. */
  tab: ConfigTab | ""
  onTab: (next: ConfigTab | "") => void
  onChanged: () => void
}) {
  const mobile = useMobile()
  const team = useTeamMode()
  const readOnly = team.mode === "team" && me.role !== "admin"
  const [group, setGroup] = useState<string>(CONFIG_GROUPS[0]?.key ?? "ai")

  if (mobile && !tab) {
    // Phone-sized settings: pick a group, then a section — 17 horizontal
    // tabs never fit a 390 px screen.
    return (
      <Box className="ob-scroll ob-view-enter">
        <Stack
          spacing={1.5}
          sx={{ p: 1.5, maxWidth: 640, width: "100%", mx: "auto" }}
        >
          <Stack spacing={0.25}>
            <Typography variant="h6">Settings</Typography>
            <Typography variant="body2" color="textSecondary">
              Choose a group, then a section.
            </Typography>
          </Stack>
          <Select
            name="config-group"
            label="Group"
            value={group}
            onSelect={(value: string) => setGroup(value)}
          >
            {CONFIG_GROUPS.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {entry.label}
              </option>
            ))}
          </Select>
          {(CONFIG_GROUPS.find((entry) => entry.key === group)?.tabs ?? []).map(
            (entry) =>
              entry === "cron" ? (
                <Button
                  key={entry}
                  variant="outlined"
                  startIcon={<ScheduleIcon />}
                  onClick={() => onTab("cron" as ConfigTab)}
                  sx={{ justifyContent: "flex-start" }}
                >
                  {CONFIG_TAB_LABELS[entry]}
                </Button>
              ) : (
                <Button
                  key={entry}
                  variant="outlined"
                  startIcon={TAB_ICONS[entry]}
                  onClick={() => onTab(entry)}
                  sx={{ justifyContent: "flex-start" }}
                >
                  <Stack sx={{ alignItems: "flex-start" }}>
                    <Typography variant="subtitle2" component="span">
                      {CONFIG_TAB_LABELS[entry]}
                    </Typography>
                    <Typography
                      variant="caption"
                      color="textSecondary"
                      component="span"
                      sx={{ whiteSpace: "normal", textAlign: "left" }}
                    >
                      {TAB_DESCRIPTIONS[entry]}
                    </Typography>
                  </Stack>
                </Button>
              ),
          )}
        </Stack>
      </Box>
    )
  }

  const activeTab: ConfigTab = (tab || "chat") as ConfigTab

  return (
    <Box className="ob-scroll ob-view-enter">
      <Stack
        spacing={2}
        sx={{ p: mobile ? 1.5 : 2, maxWidth: 1024, mx: "auto", width: "100%" }}
      >
        <Stack direction="row" spacing={1} alignItems="center">
          {mobile ? (
            <IconButton
              size="small"
              aria-label="Back to settings sections"
              onClick={() => onTab("")}
            >
              <ArrowBackIcon />
            </IconButton>
          ) : null}
          <Stack spacing={0.25} sx={{ minWidth: 0 }}>
            <Typography variant="h6" sx={{ whiteSpace: "nowrap" }}>
              {mobile ? CONFIG_TAB_LABELS[activeTab] : "Settings"}
            </Typography>
            <Typography variant="body2" color="textSecondary">
              {mobile
                ? TAB_DESCRIPTIONS[activeTab]
                : `${CONFIG_TAB_LABELS[activeTab]} — ${TAB_DESCRIPTIONS[activeTab]} Pick a section in the sidebar to switch.`}
            </Typography>
          </Stack>
        </Stack>
        {renderSection(
          activeTab,
          me,
          onChanged,
          readOnly,
          team.lockModelPicker,
        )}
      </Stack>
    </Box>
  )
}
