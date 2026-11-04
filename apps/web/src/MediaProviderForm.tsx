import Alert from "@shpaw415/mui-lite/Alert"
import Button from "@shpaw415/mui-lite/Button"
import Select from "@shpaw415/mui-lite/Select"
import { type ReactNode, useEffect, useState } from "react"
import { api, isTeamLockedError } from "./api"
import { ConfigSection } from "./ConfigSection"
import { CatalogFields, CatalogModelSelect } from "./ProviderFields"
import {
  hasField,
  isCustomModel,
  modelFor,
  type ProviderFieldKey,
  type PublicCatalogSpec,
  specForId,
} from "./provider-catalog"
import Stack from "./stack"
import { useVaultOverride } from "./vault-lock"

export type MediaKind = "image" | "video" | "model3d"

type MediaForm = {
  providers: PublicCatalogSpec[]
  provider: string
  accountId: string
  model: string
  hasKey: boolean
  keySource?: "setup" | "vault" | null
}

export type MediaProviderFormProps = {
  kind: MediaKind
  icon: ReactNode
  title: string
  description: string
  saveLabel: string
  noun: string
  savedApplied: string
  readOnly?: boolean
}

// The shared per-user form behind the Image / Video / 3D Config sections —
// they differ only in endpoint, icon and copy. Renders the selected
// provider's catalog fields and model select, nothing else.
export function MediaProviderForm({
  kind,
  icon,
  title,
  description,
  saveLabel,
  noun,
  savedApplied,
  readOnly = false,
}: MediaProviderFormProps) {
  const apiPath = `/api/${kind}`
  const [error, setError] = useState("")
  const [saved, setSaved] = useState("")
  const [busy, setBusy] = useState(false)
  const [hasKey, setHasKey] = useState(false)
  const [keySource, setKeySource] = useState<"setup" | "vault" | null>(null)
  const [providers, setProviders] = useState<PublicCatalogSpec[]>([])
  const [provider, setProvider] = useState("")
  const [savedProvider, setSavedProvider] = useState("")
  const [accountId, setAccountId] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [model, setModel] = useState("")
  const [modelCustom, setModelCustom] = useState(false)

  const spec = specForId(providers, provider) ?? providers[0]
  const vault = useVaultOverride(keySource)
  const keyKept = hasKey && provider === savedProvider

  useEffect(() => {
    void api<MediaForm>(apiPath)
      .then((body) => {
        const catalog = body.providers ?? []
        const selected = specForId(catalog, body.provider) ?? catalog[0]
        const loadedModel = body.model || selected?.defaultModel || ""
        setProviders(catalog)
        setProvider(selected?.id ?? "")
        setSavedProvider(selected?.id ?? "")
        setAccountId(body.accountId)
        setHasKey(body.hasKey)
        setKeySource(body.keySource ?? null)
        setModel(loadedModel)
        setModelCustom(isCustomModel(selected, loadedModel))
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : "failed")
      })
  }, [apiPath])

  function pickProvider(id: string) {
    const next = specForId(providers, id)
    setProvider(id)
    setSaved("")
    setModel(next?.defaultModel ?? "")
    setModelCustom(false)
    if (!hasField(next, "accountId")) setAccountId("")
  }

  function setField(key: ProviderFieldKey, value: string) {
    if (key === "accountId") setAccountId(value)
    else if (key === "apiKey") setApiKey(value)
    setSaved("")
  }

  const incomplete = (() => {
    if (!spec || vault.locked) return false
    if (hasField(spec, "accountId")?.required && accountId.trim() === "") {
      return true
    }
    if (
      hasField(spec, "apiKey")?.required &&
      apiKey.trim() === "" &&
      !keyKept &&
      keySource !== "vault"
    ) {
      return true
    }
    return (
      spec.models.length > 0 &&
      model !== "" &&
      !modelCustom &&
      !modelFor(spec, model)
    )
  })()

  async function save() {
    setError("")
    setSaved("")
    setBusy(true)
    try {
      const body = await api<{
        applied?: boolean
        keySource?: "setup" | "vault" | null
      }>(apiPath, {
        method: "PUT",
        body: JSON.stringify({
          provider: spec?.id ?? provider,
          accountId: hasField(spec, "accountId") ? accountId : "",
          apiKey,
          model,
        }),
      })
      setHasKey(true)
      setSavedProvider(spec?.id ?? provider)
      setKeySource(body.keySource ?? "setup")
      setApiKey("")
      setSaved(
        body.applied ? savedApplied : "Saved. Applies when the desktop starts.",
      )
    } catch (caught) {
      setError(
        isTeamLockedError(caught)
          ? `Managed by your admin — the team's shared ${noun} provider changed since this page loaded.`
          : caught instanceof Error
            ? caught.message
            : "save failed",
      )
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setError("")
    setSaved("")
    setBusy(true)
    try {
      await api(apiPath, { method: "DELETE" })
      const first = providers[0]
      setHasKey(false)
      setKeySource(null)
      setAccountId("")
      setApiKey("")
      setProvider(first?.id ?? "")
      setSavedProvider(first?.id ?? "")
      setModel(first?.defaultModel ?? "")
      setModelCustom(false)
      setSaved("Removed.")
    } catch (caught) {
      setError(
        isTeamLockedError(caught)
          ? `Managed by your admin — the team's shared ${noun} provider cannot be removed here.`
          : caught instanceof Error
            ? caught.message
            : "remove failed",
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <ConfigSection
      icon={icon}
      title={title}
      description={description}
      status={
        hasKey
          ? { label: spec?.label ?? "Configured", color: "success" }
          : keySource === "vault"
            ? { label: "Vault key", color: "primary" }
            : { label: "Not set" }
      }
    >
      <Stack spacing={1.5}>
        {error ? <Alert severity="error">{error}</Alert> : null}
        {saved ? <Alert severity="success">{saved}</Alert> : null}
        {readOnly ? (
          <Alert severity="info">
            Managed by your admin — the team's shared {noun} provider applies to
            everyone.
          </Alert>
        ) : null}
        <Select
          name={`${kind}-provider`}
          label="Provider"
          value={spec?.id ?? ""}
          disabled={providers.length === 0 || readOnly}
          onSelect={pickProvider}
        >
          {providers.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </Select>
        {spec ? (
          <>
            <CatalogFields
              spec={spec}
              values={{ accountId, apiKey }}
              onChange={setField}
              disabled={readOnly}
              locked={vault.locked}
              onOverride={vault.override}
              hasSavedSecret={keyKept}
            />
            <CatalogModelSelect
              name={`${kind}-model`}
              spec={spec}
              model={model}
              custom={modelCustom}
              disabled={readOnly}
              onPick={(next, custom) => {
                setModel(next)
                setModelCustom(custom)
                setSaved("")
              }}
            />
          </>
        ) : null}
        {readOnly ? null : (
          <Stack direction="row" spacing={1}>
            <Button
              variant="contained"
              disabled={busy || !spec || incomplete}
              onClick={() => void save()}
            >
              {saveLabel}
            </Button>
            {hasKey ? (
              <Button
                variant="text"
                disabled={busy}
                onClick={() => void remove()}
              >
                Remove
              </Button>
            ) : null}
          </Stack>
        )}
      </Stack>
    </ConfigSection>
  )
}
