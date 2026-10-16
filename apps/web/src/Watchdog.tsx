import Alert from "@shpaw415/mui-lite/Alert"
import Box from "@shpaw415/mui-lite/Box"
import Button from "@shpaw415/mui-lite/Button"
import Chip from "@shpaw415/mui-lite/Chip"
import Collapse from "@shpaw415/mui-lite/Collapse"
import Select from "@shpaw415/mui-lite/Select"
import Stack from "@shpaw415/mui-lite/Stack"
import Switch from "@shpaw415/mui-lite/Switch"
import TextField from "@shpaw415/mui-lite/TextField"
import Typography from "@shpaw415/mui-lite/Typography"
import { useCallback, useEffect, useState } from "react"
import { api } from "./api"
import { ConfigSection } from "./ConfigSection"
import { useEventStream } from "./hooks"
import { SecurityIcon } from "./icons"
import { useVaultOverride, VaultOverrideButton } from "./vault-lock"

type Severity = "info" | "low" | "medium" | "high"

type Finding = {
  id: string
  sessionId: string | null
  source: "prompt" | "response" | "tool_input" | "tool_output"
  category: string
  severity: Severity
  title: string
  excerpt: string
  rules: string[]
  verdict: { label: string; reason: string; model: string } | null
  action: "none" | "alerted" | "stopped"
  status: "new" | "reviewed" | "dismissed"
  hits: number
  createdAt: number
  lastSeenAt: number
}

type ProviderSpec = {
  id: string
  label: string
  defaultModel: string
  accountRequired: boolean
  needsBaseUrl: boolean
}

type WatchdogState = {
  providers: ProviderSpec[]
  config: {
    enabled: boolean
    stopOnHigh: boolean
    provider: string
    accountId: string
    model: string
    baseUrl: string
    hasKey: boolean
    keySource: "setup" | "vault" | null
  }
  findings: Finding[]
  unread: number
}

const SEVERITY_COLOR: Record<
  Severity,
  "primary" | "warning" | "error" | "success" | undefined
> = {
  info: undefined,
  low: "primary",
  medium: "warning",
  high: "error",
}

const SOURCE_LABELS: Record<Finding["source"], string> = {
  prompt: "prompt",
  response: "response",
  tool_input: "tool input",
  tool_output: "tool output",
}

function formatAgo(ts: number) {
  const minutes = Math.round((Date.now() - ts) / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

function statusLabel(config: WatchdogState["config"]): {
  label: string
  color?: "success" | "warning" | "error"
} {
  if (!config.enabled) return { label: "Off" }
  if (!config.provider) return { label: "Rules only" }
  if (config.keySource === null) return { label: "No key", color: "warning" }
  return { label: "On", color: "success" }
}

function WatchdogConfigSection({
  state,
  onChanged,
}: {
  state: WatchdogState
  onChanged: () => void
}) {
  const config = state.config
  const [provider, setProvider] = useState(config.provider)
  const [accountId, setAccountId] = useState(config.accountId)
  const [apiKey, setApiKey] = useState("")
  const [model, setModel] = useState(config.model)
  const [baseUrl, setBaseUrl] = useState(config.baseUrl)
  const [enabled, setEnabled] = useState(config.enabled)
  const [stopOnHigh, setStopOnHigh] = useState(config.stopOnHigh)
  const [error, setError] = useState("")
  const [saved, setSaved] = useState("")
  const [busy, setBusy] = useState(false)
  const vault = useVaultOverride(config.keySource)

  useEffect(() => {
    setProvider(config.provider)
    setAccountId(config.accountId)
    setModel(config.model)
    setBaseUrl(config.baseUrl)
    setEnabled(config.enabled)
    setStopOnHigh(config.stopOnHigh)
  }, [config])

  const spec = state.providers.find((item) => item.id === provider)

  async function save(next: { enabled?: boolean; stopOnHigh?: boolean } = {}) {
    setError("")
    setSaved("")
    setBusy(true)
    try {
      await api("/api/watchdog/config", {
        method: "PUT",
        body: JSON.stringify({
          enabled: next.enabled ?? enabled,
          stopOnHigh: next.stopOnHigh ?? stopOnHigh,
          provider,
          accountId,
          apiKey,
          model,
          baseUrl,
        }),
      })
      setSaved("Saved. The desktop watchdog picks this up within a minute.")
      setApiKey("")
      onChanged()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "save failed")
    } finally {
      setBusy(false)
    }
  }

  async function clearProvider() {
    setError("")
    setSaved("")
    setBusy(true)
    try {
      await api("/api/watchdog/config", { method: "DELETE" })
      setSaved("Provider cleared — the watchdog stays on in rules-only mode.")
      onChanged()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "clear failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <ConfigSection
      icon={<SecurityIcon />}
      title="Watchdog"
      description="Monitors model exchanges inside your desktop for prompt injections, secret leaks, and dangerous commands. Rules run always; an LLM provider adds a second opinion. High-severity findings stop the running turn when the toggle below is on."
      status={statusLabel(config)}
    >
      <Stack spacing={1.5}>
        {error ? <Alert severity="error">{error}</Alert> : null}
        {saved ? <Alert severity="success">{saved}</Alert> : null}
        <Stack
          direction="row"
          spacing={2}
          alignItems="center"
          flexWrap="wrap"
          useFlexGap
        >
          <Switch
            checked={enabled}
            disabled={busy}
            onChange={(event) => {
              const next = event.currentTarget.checked
              setEnabled(next)
              void save({ enabled: next })
            }}
          />
          <Typography variant="body2">Watchdog enabled</Typography>
          <Switch
            checked={stopOnHigh}
            disabled={busy}
            onChange={(event) => {
              const next = event.currentTarget.checked
              setStopOnHigh(next)
              void save({ stopOnHigh: next })
            }}
          />
          <Typography variant="body2">
            Stop the turn on high-severity findings
          </Typography>
        </Stack>
        <Select
          name="watchdog-provider"
          label="Verdict provider (optional)"
          value={provider}
          disabled={busy}
          onSelect={(value: string) => {
            setProvider(value)
            const nextSpec = state.providers.find((item) => item.id === value)
            setModel(nextSpec?.defaultModel ?? "")
          }}
        >
          {[
            <option key="none" value="">
              None — rules only
            </option>,
            ...state.providers.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            )),
          ]}
        </Select>
        {spec ? (
          <>
            {spec.accountRequired ? (
              <Stack direction="row" spacing={1} alignItems="center">
                <TextField
                  label={
                    vault.locked ? "Account ID (from vault)" : "Account ID"
                  }
                  value={vault.locked ? accountId : accountId}
                  placeholder="Cloudflare account ID"
                  disabled={busy || vault.locked}
                  sx={{ flex: 1 }}
                  onChange={(event) => setAccountId(event.currentTarget.value)}
                />
                {vault.locked ? (
                  <VaultOverrideButton onClick={vault.override} />
                ) : null}
              </Stack>
            ) : null}
            <Stack direction="row" spacing={1} alignItems="center">
              <TextField
                label={
                  vault.locked
                    ? "Using the vault key"
                    : config.hasKey
                      ? "API key (blank keeps the saved key)"
                      : "API key"
                }
                type={vault.locked ? undefined : "password"}
                value={vault.locked ? "" : apiKey}
                placeholder={vault.locked ? "••••••••" : undefined}
                disabled={busy || vault.locked}
                sx={{ flex: 1 }}
                onChange={(event) => setApiKey(event.currentTarget.value)}
              />
              {vault.locked ? (
                <VaultOverrideButton onClick={vault.override} />
              ) : null}
            </Stack>
            <TextField
              label="Model"
              value={model}
              placeholder={spec.defaultModel}
              disabled={busy}
              onChange={(event) => setModel(event.currentTarget.value)}
            />
            {spec.needsBaseUrl ? (
              <TextField
                label="Base URL"
                value={baseUrl}
                placeholder="https://gateway.example/v1"
                disabled={busy}
                onChange={(event) => setBaseUrl(event.currentTarget.value)}
              />
            ) : null}
            <Typography variant="caption" color="textSecondary">
              Only flagged snippets are sent to this provider, redacted first.
              Cloudflare Workers AI and xAI keys can come from the vault (Keys
              tab) instead.
            </Typography>
          </>
        ) : null}
        <Stack direction="row" spacing={1}>
          <Button
            variant="contained"
            disabled={busy}
            onClick={() => void save()}
          >
            Save watchdog settings
          </Button>
          {config.provider ? (
            <Button
              variant="text"
              color="error"
              disabled={busy}
              onClick={() => void clearProvider()}
            >
              Remove provider
            </Button>
          ) : null}
        </Stack>
      </Stack>
    </ConfigSection>
  )
}

function FindingCard({
  finding,
  onChanged,
}: {
  finding: Finding
  onChanged: () => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  async function setStatus(status: Finding["status"]) {
    setBusy(true)
    try {
      await api(`/api/watchdog/findings/${encodeURIComponent(finding.id)}`, {
        method: "POST",
        body: JSON.stringify({ status }),
      })
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Box sx={{ p: 1.25, border: 1, borderColor: "divider", borderRadius: 2 }}>
      <Stack spacing={0.75}>
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          flexWrap="wrap"
          useFlexGap
        >
          <Chip size="small" color={SEVERITY_COLOR[finding.severity]}>
            {finding.severity}
          </Chip>
          {finding.action === "stopped" ? (
            <Chip size="small" color="error" variant="outlined">
              turn stopped
            </Chip>
          ) : null}
          <Typography variant="body2" sx={{ flex: 1, minWidth: 160 }}>
            {finding.title}
          </Typography>
          <Typography variant="caption" color="textSecondary">
            {formatAgo(finding.lastSeenAt)}
            {finding.hits > 1 ? ` · ${finding.hits}×` : ""}
          </Typography>
        </Stack>
        <Typography variant="caption" color="textSecondary">
          {SOURCE_LABELS[finding.source]} ·{" "}
          {finding.category.replace(/_/g, " ")}
          {finding.sessionId ? " · session open" : ""}
          {finding.verdict ? ` · verdict: ${finding.verdict.label}` : ""}
        </Typography>
        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
          {finding.rules.slice(0, 6).map((rule) => (
            <Chip key={rule} size="small" variant="outlined" label={rule} />
          ))}
        </Stack>
        <Stack direction="row" spacing={1} alignItems="center">
          <Button size="small" variant="text" onClick={() => setOpen(!open)}>
            {open ? "Hide snippet" : "Show snippet"}
          </Button>
          {finding.status === "new" ? (
            <>
              <Button
                size="small"
                variant="text"
                disabled={busy}
                onClick={() => void setStatus("reviewed")}
              >
                Reviewed
              </Button>
              <Button
                size="small"
                variant="text"
                color="error"
                disabled={busy}
                onClick={() => void setStatus("dismissed")}
              >
                Dismiss
              </Button>
            </>
          ) : (
            <Chip size="small" variant="outlined">
              {finding.status}
            </Chip>
          )}
        </Stack>
        <Collapse in={open}>
          <pre
            style={{
              margin: 0,
              padding: 8,
              borderRadius: 8,
              background: "rgba(127,127,127,0.12)",
              fontSize: 12,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              maxHeight: 240,
              overflow: "auto",
            }}
          >
            {finding.excerpt}
            {finding.verdict?.reason
              ? `\n\nverdict (${finding.verdict.model}): ${finding.verdict.reason}`
              : ""}
          </pre>
        </Collapse>
      </Stack>
    </Box>
  )
}

function FindingsSection({
  state,
  onChanged,
}: {
  state: WatchdogState
  onChanged: () => void
}) {
  const [filter, setFilter] = useState<"all" | "new" | Severity>("all")
  const findings = state.findings.filter((finding) => {
    if (filter === "all") return finding.status !== "dismissed"
    if (filter === "new") return finding.status === "new"
    return finding.severity === filter && finding.status !== "dismissed"
  })
  return (
    <ConfigSection
      icon={<SecurityIcon />}
      title="Findings"
      description="Detections from the desktop watchdog. Snippets are redacted before storage."
      status={
        state.unread > 0
          ? { label: `${state.unread} new`, color: "warning" }
          : null
      }
    >
      <Stack spacing={1.5}>
        <Select
          name="watchdog-filter"
          label="Filter"
          value={filter}
          onSelect={(value: string) => setFilter(value as typeof filter)}
        >
          <option value="all">All active</option>
          <option value="new">New only</option>
          <option value="high">High severity</option>
          <option value="medium">Medium severity</option>
          <option value="low">Low severity</option>
        </Select>
        {findings.length === 0 ? (
          <Typography variant="body2" color="textSecondary">
            Nothing flagged so far. The watchdog watches every thread, including
            background and scheduled ones.
          </Typography>
        ) : (
          findings.map((finding) => (
            <FindingCard
              key={finding.id}
              finding={finding}
              onChanged={onChanged}
            />
          ))
        )}
      </Stack>
    </ConfigSection>
  )
}

export function Watchdog() {
  const [state, setState] = useState<WatchdogState | null>(null)
  const [error, setError] = useState("")
  const { subscribe } = useEventStream(true)

  const load = useCallback(async () => {
    try {
      const body = await api<WatchdogState>("/api/watchdog")
      setState(body)
      setError("")
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "failed to load")
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    return subscribe((event) => {
      if (event.type === "security.notice") void load()
    })
  }, [subscribe, load])

  if (error && !state) {
    return (
      <ConfigSection icon={<SecurityIcon />} title="Watchdog">
        <Alert severity="error">{error}</Alert>
      </ConfigSection>
    )
  }
  if (!state) {
    return (
      <ConfigSection icon={<SecurityIcon />} title="Watchdog">
        <Typography variant="body2" color="textSecondary">
          Loading watchdog state…
        </Typography>
      </ConfigSection>
    )
  }
  return (
    <>
      <WatchdogConfigSection state={state} onChanged={() => void load()} />
      <FindingsSection state={state} onChanged={() => void load()} />
    </>
  )
}
