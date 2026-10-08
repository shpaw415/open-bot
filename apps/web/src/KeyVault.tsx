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
import { VpnKeyIcon } from "./icons"

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

export function KeyVault() {
  const [catalog, setCatalog] = useState<VaultSpec[]>([])
  const [entries, setEntries] = useState<VaultEntry[]>([])
  const [sources, setSources] = useState<Record<string, string | null>>({})
  const [values, setValues] = useState<Record<string, string>>({})
  const [error, setError] = useState("")
  const [saved, setSaved] = useState("")
  const [busy, setBusy] = useState("")

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
        spec.chatProvider
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

  return (
    <ConfigSection
      icon={<VpnKeyIcon />}
      title="Provider keys"
      description="Shared API keys for this account. Provider setups below use these when their own key is blank; a key typed into a provider setup always wins."
      status={
        vaultUsers.length > 0
          ? { label: `${vaultUsers.length} in use`, color: "primary" }
          : null
      }
    >
      <Stack spacing={1.5}>
        {error ? <Alert severity="error">{error}</Alert> : null}
        {saved ? <Alert severity="success">{saved}</Alert> : null}
        {vaultUsers.length > 0 ? (
          <Stack direction="row" spacing={0.5} flexWrap="wrap">
            {vaultUsers.map(([kind]) => (
              <Chip key={kind} size="small" label={`${kind}: vault key`} />
            ))}
          </Stack>
        ) : null}
        {catalog.map((spec, index) => {
          const entry = entries.find((item) => item.slug === spec.id)
          const anySaved = spec.fields.some((field) =>
            fieldSaved(entry, field.id),
          )
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
                  <Typography variant="subtitle2">{spec.label}</Typography>
                  {entry?.hasKey ? (
                    <Chip size="small" color="success" label="Key saved" />
                  ) : anySaved ? (
                    <Chip size="small" color="warning" label="Partial" />
                  ) : (
                    <Chip size="small" label="Not set" />
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
                        setFieldValue(
                          spec.id,
                          field.id,
                          event.currentTarget.value,
                        )
                      }
                    />
                  )
                })}
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
              </Stack>
            </Box>
          )
        })}
      </Stack>
    </ConfigSection>
  )
}
