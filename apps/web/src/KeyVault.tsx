import Alert from "@shpaw415/mui-lite/Alert"
import Box from "@shpaw415/mui-lite/Box"
import Button from "@shpaw415/mui-lite/Button"
import Chip from "@shpaw415/mui-lite/Chip"
import Divider from "@shpaw415/mui-lite/Divider"
import Stack from "@shpaw415/mui-lite/Stack"
import TextField from "@shpaw415/mui-lite/TextField"
import Typography from "@shpaw415/mui-lite/Typography"
import { useCallback, useEffect, useState } from "react"
import { api } from "./api"
import { ConfigSection } from "./ConfigSection"
import { ExtensionIcon, VpnKeyIcon } from "./icons"
import { useTeamMode } from "./team"

type VaultField = {
  id: string
  label: string
  placeholder: string
  required: boolean
}

type VaultSpec = {
  id: string
  label: string
  description: string
  chatProvider: boolean
  fields: VaultField[]
  usedBy: string[]
  plugin?: boolean
  pluginIds?: string[]
  access?: "create" | "read"
  enabled?: boolean
}

type VaultEntry = {
  slug: string
  accountId: string
  gatewayId: string
  gatewaySlug: string
  baseUrl: string
  hasKey: boolean
  hasGatewayToken: boolean
  updatedAt: number
}

type KeyVaultForm = {
  catalog: VaultSpec[]
  entries: VaultEntry[]
  sources: Record<string, string | null>
}

const secretFields = new Set(["apiKey", "gatewayToken"])

function fieldSaved(entry: VaultEntry | undefined, field: string) {
  if (!entry) return false
  if (field === "apiKey") return entry.hasKey
  if (field === "gatewayToken") return entry.hasGatewayToken
  if (field === "accountId") return entry.accountId !== ""
  if (field === "gatewayId") return entry.gatewayId !== ""
  if (field === "gatewaySlug") return entry.gatewaySlug !== ""
  if (field === "baseUrl") return entry.baseUrl !== ""
  return false
}

export function KeyVault({ isAdmin = false }: { isAdmin?: boolean }) {
  const [catalog, setCatalog] = useState<VaultSpec[]>([])
  const [entries, setEntries] = useState<VaultEntry[]>([])
  const [sources, setSources] = useState<Record<string, string | null>>({})
  const [values, setValues] = useState<Record<string, string>>({})
  const [error, setError] = useState("")
  const [saved, setSaved] = useState("")
  const [busy, setBusy] = useState("")
  const team = useTeamMode()
  const shared = team.mode === "team"
  const adminNote =
    "Team mode is on — shared keys are managed on the Admin page's Team section."

  const load = useCallback(() => {
    return api<KeyVaultForm>("/api/keys")
      .then((body) => {
        setCatalog(body.catalog ?? [])
        setEntries(body.entries ?? [])
        setSources(body.sources ?? {})
        const next: Record<string, string> = {}
        for (const entry of body.entries ?? []) {
          for (const field of [
            "accountId",
            "gatewayId",
            "gatewaySlug",
            "baseUrl",
          ]) {
            const value = (entry as unknown as Record<string, string>)[field]
            if (value) next[`${entry.slug}:${field}`] = value
          }
        }
        setValues(next)
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : "failed")
      })
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const providerSpecs = catalog.filter((spec) => !spec.plugin)
  const pluginSpecs = catalog.filter((spec) => spec.plugin)

  function fieldValue(slug: string, field: string) {
    return values[`${slug}:${field}`] ?? ""
  }

  function setFieldValue(slug: string, field: string, value: string) {
    setValues((prev) => ({ ...prev, [`${slug}:${field}`]: value }))
  }

  async function saveEntry(spec: VaultSpec) {
    setError("")
    setSaved("")
    setBusy(spec.id)
    try {
      const body: Record<string, string> = { slug: spec.id }
      for (const field of spec.fields) {
        body[field.id] = fieldValue(spec.id, field.id)
      }
      await api("/api/keys", { method: "PUT", body: JSON.stringify(body) })
      setValues((prev) => {
        const next = { ...prev }
        for (const field of spec.fields) delete next[`${spec.id}:${field.id}`]
        return next
      })
      await load()
      setSaved(
        spec.plugin
          ? `Saved. The ${spec.label} key reaches the plugin on its next run.`
          : spec.chatProvider
            ? `Saved. ${spec.label} keys sync to chat providers when the desktop starts.`
            : `Saved. ${spec.label} keys now back the matching provider setups.`,
      )
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "save failed")
    } finally {
      setBusy("")
    }
  }

  async function removeEntry(spec: VaultSpec) {
    setError("")
    setSaved("")
    setBusy(spec.id)
    try {
      await api(`/api/keys?slug=${encodeURIComponent(spec.id)}`, {
        method: "DELETE",
      })
      setValues((prev) => {
        const next = { ...prev }
        for (const field of spec.fields) delete next[`${spec.id}:${field.id}`]
        return next
      })
      await load()
      setSaved(`Removed the ${spec.label} entry.`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "remove failed")
    } finally {
      setBusy("")
    }
  }

  const vaultUsers = Object.entries(sources).filter(
    ([, source]) => source === "vault",
  )

  function renderEntry(spec: VaultSpec, index: number) {
    const entry = entries.find((item) => item.slug === spec.id)
    const anySaved = spec.fields.some((field) => fieldSaved(entry, field.id))
    return (
      <Box key={spec.id}>
        {index > 0 ? <Divider sx={{ mb: 1.5 }} /> : null}
        <Stack spacing={1}>
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            flexWrap="wrap"
          >
            <Typography
              variant="subtitle2"
              sx={spec.plugin ? { fontFamily: "monospace" } : undefined}
            >
              {spec.label}
            </Typography>
            {spec.plugin ? (
              <Chip
                size="small"
                variant="outlined"
                icon={<ExtensionIcon />}
                label="Plugin key"
              />
            ) : null}
            {spec.plugin && spec.access === "create" ? (
              <Chip size="small" variant="outlined">
                agent can set
              </Chip>
            ) : null}
            {spec.plugin && spec.enabled === false ? (
              <Chip size="small" color="warning">
                plugin disabled
              </Chip>
            ) : null}
            {entry?.hasKey ? (
              <Chip size="small" color="success">
                Key saved
              </Chip>
            ) : anySaved ? (
              <Chip size="small" color="warning">
                Partial
              </Chip>
            ) : (
              <Chip size="small">Not set</Chip>
            )}
          </Stack>
          <Typography variant="body2" color="textSecondary">
            {spec.description}
            {spec.usedBy.length > 0
              ? ` Used by: ${spec.usedBy.join(", ")}.`
              : ""}
          </Typography>
          {spec.fields.map((field) => {
            const hasSaved = fieldSaved(entry, field.id)
            if (shared) {
              return hasSaved ? (
                <Chip key={field.id} size="small" variant="outlined">
                  {field.label} saved
                </Chip>
              ) : null
            }
            return (
              <TextField
                key={field.id}
                label={
                  hasSaved && secretFields.has(field.id)
                    ? `${field.label} (blank keeps the saved key)`
                    : field.label
                }
                type={secretFields.has(field.id) ? "password" : "text"}
                value={fieldValue(spec.id, field.id)}
                placeholder={field.placeholder}
                onChange={(event) =>
                  setFieldValue(spec.id, field.id, event.currentTarget.value)
                }
              />
            )
          })}
          {shared ? null : (
            <Stack direction="row" spacing={1}>
              <Button
                variant="contained"
                disabled={busy === spec.id}
                onClick={() => void saveEntry(spec)}
              >
                Save
              </Button>
              {anySaved ? (
                <Button
                  variant="text"
                  disabled={busy === spec.id}
                  onClick={() => void removeEntry(spec)}
                >
                  Remove
                </Button>
              ) : null}
            </Stack>
          )}
        </Stack>
      </Box>
    )
  }

  return (
    <Stack spacing={3}>
      <ConfigSection
        icon={<VpnKeyIcon />}
        title="Provider keys"
        description={
          shared
            ? isAdmin
              ? adminNote
              : "Managed by your admin — this host runs in team mode on one shared key set, so these entries are read-only here."
            : "Shared API keys for this account. Provider setups below use these when their own key is blank; a key typed into a provider setup always wins. Keys that installed plugins declare are merged into this page too."
        }
        status={
          shared
            ? { label: "Team", color: "primary" }
            : vaultUsers.length > 0
              ? { label: `${vaultUsers.length} in use`, color: "primary" }
              : null
        }
      >
        <Stack spacing={1.5}>
          {shared ? (
            <Alert severity="info">
              {isAdmin
                ? adminNote
                : "Managed by your admin — key changes are handled on the host, not here."}
            </Alert>
          ) : null}
          {error ? <Alert severity="error">{error}</Alert> : null}
          {saved ? <Alert severity="success">{saved}</Alert> : null}
          {vaultUsers.length > 0 ? (
            <Stack direction="row" spacing={0.5} flexWrap="wrap">
              {vaultUsers.map(([kind]) => (
                <Chip key={kind} size="small">{`${kind}: vault key`}</Chip>
              ))}
            </Stack>
          ) : null}
          {providerSpecs.map((spec, index) => renderEntry(spec, index))}
        </Stack>
      </ConfigSection>
      {pluginSpecs.length > 0 ? (
        <ConfigSection
          icon={<ExtensionIcon />}
          title="Plugin keys"
          description={
            shared
              ? "Managed by your admin — plugin keys follow the same shared set in team mode."
              : "API keys declared by installed plugins and merged into this vault, so every key lives in one place. Shared provider keys a plugin reads stay in the list above."
          }
        >
          <Stack spacing={1.5}>
            {pluginSpecs.map((spec, index) => renderEntry(spec, index))}
          </Stack>
        </ConfigSection>
      ) : null}
    </Stack>
  )
}
