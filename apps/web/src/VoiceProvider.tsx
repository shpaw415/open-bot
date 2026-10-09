import Alert from "@shpaw415/mui-lite/Alert"
import Button from "@shpaw415/mui-lite/Button"
import Divider from "@shpaw415/mui-lite/Divider"
import Select from "@shpaw415/mui-lite/Select"
import Stack from "@shpaw415/mui-lite/Stack"
import TextField from "@shpaw415/mui-lite/TextField"
import Typography from "@shpaw415/mui-lite/Typography"
import { useEffect, useState } from "react"
import { api } from "./api"
import { ConfigSection } from "./ConfigSection"
import { MicIcon } from "./icons"
import { useVaultOverride, VaultOverrideButton } from "./vault-lock"

type VoiceField = {
  label: string
  placeholder: string
  required?: boolean
}

type VoiceSpec = {
  id: string
  label: string
  kind: "stt" | "tts"
  defaultModel: string
  modelOptional: boolean
  defaultVoice: string
  account: VoiceField | null
  secret: VoiceField
}

type SideState = {
  provider: string
  accountId: string
  apiKey: string
  model: string
  voice: string
  hasKey: boolean
  keySource: "setup" | "vault" | null
}

const LANGUAGES: [string, string][] = [
  ["auto", "Auto (STT only)"],
  ["en", "English"],
  ["fr", "French"],
  ["es", "Spanish"],
  ["de", "German"],
  ["it", "Italian"],
  ["pt", "Portuguese"],
  ["nl", "Dutch"],
  ["ru", "Russian"],
  ["ar", "Arabic"],
  ["hi", "Hindi"],
  ["zh", "Chinese"],
  ["ja", "Japanese"],
  ["ko", "Korean"],
]

const emptySide: SideState = {
  provider: "",
  accountId: "",
  apiKey: "",
  model: "",
  voice: "",
  hasKey: false,
  keySource: null,
}

type VoiceForm = {
  providers: VoiceSpec[]
  stt: {
    provider: string
    accountId: string
    model: string
    hasKey: boolean
    keySource?: "setup" | "vault" | null
  }
  tts: {
    provider: string
    accountId: string
    model: string
    voice: string
    hasKey: boolean
    keySource?: "setup" | "vault" | null
  }
  language: string
}

export function VoiceProvider() {
  const [error, setError] = useState("")
  const [saved, setSaved] = useState("")
  const [busy, setBusy] = useState(false)
  const [providers, setProviders] = useState<VoiceSpec[]>([])
  const [stt, setStt] = useState<SideState>(emptySide)
  const [tts, setTts] = useState<SideState>(emptySide)
  const [language, setLanguage] = useState("auto")
  const sttVault = useVaultOverride(stt.keySource)
  const ttsVault = useVaultOverride(tts.keySource)

  const sttSpec = providers.find(
    (item) => item.kind === "stt" && item.id === stt.provider,
  )
  const ttsSpec = providers.find(
    (item) => item.kind === "tts" && item.id === tts.provider,
  )
  const sttLocked = sttVault.locked
  const ttsLocked = ttsVault.locked

  useEffect(() => {
    void api<VoiceForm>("/api/voice")
      .then((body) => {
        setProviders(body.providers ?? [])
        setStt({
          ...emptySide,
          provider: body.stt?.provider ?? "",
          accountId: body.stt?.accountId ?? "",
          model: body.stt?.model ?? "",
          hasKey: Boolean(body.stt?.hasKey),
          keySource: body.stt?.keySource ?? null,
        })
        setTts({
          ...emptySide,
          provider: body.tts?.provider ?? "",
          accountId: body.tts?.accountId ?? "",
          model: body.tts?.model ?? "",
          voice: body.tts?.voice ?? "",
          hasKey: Boolean(body.tts?.hasKey),
          keySource: body.tts?.keySource ?? null,
        })
        setLanguage(body.language || "auto")
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : "failed")
      })
  }, [])

  function pickSide(
    side: "stt" | "tts",
    id: string,
    state: SideState,
    set: (next: SideState) => void,
  ) {
    const specs = providers.filter((item) => item.kind === side)
    const next = specs.find((item) => item.id === id)
    const prev = specs.find((item) => item.id === state.provider)
    set({
      ...state,
      provider: id,
      model:
        !state.model || state.model === prev?.defaultModel
          ? (next?.defaultModel ?? "")
          : state.model,
      voice: next?.defaultVoice ?? "",
      accountId: next?.account ? state.accountId : "",
    })
    setSaved("")
  }

  async function save() {
    setError("")
    setSaved("")
    setBusy(true)
    try {
      const body = await api<{
        sttKeySource?: "setup" | "vault" | null
        ttsKeySource?: "setup" | "vault" | null
      }>("/api/voice", {
        method: "PUT",
        body: JSON.stringify({
          stt: {
            provider: stt.provider,
            accountId: stt.accountId,
            apiKey: stt.apiKey,
            model: stt.model,
          },
          tts: {
            provider: tts.provider,
            accountId: tts.accountId,
            apiKey: tts.apiKey,
            model: tts.model,
            voice: tts.voice,
          },
          language,
        }),
      })
      setStt({
        ...stt,
        apiKey: "",
        hasKey: Boolean(stt.provider),
        keySource: body.sttKeySource ?? null,
      })
      setTts({
        ...tts,
        apiKey: "",
        hasKey: Boolean(tts.provider),
        keySource: body.ttsKeySource ?? null,
      })
      setSaved("Saved. Voice works right away.")
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "save failed")
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setError("")
    setSaved("")
    setBusy(true)
    try {
      await api("/api/voice", { method: "DELETE" })
      setStt(emptySide)
      setTts(emptySide)
      setLanguage("auto")
      setSaved("Removed.")
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "remove failed")
    } finally {
      setBusy(false)
    }
  }

  const anyKey = stt.hasKey || tts.hasKey
  const status = anyKey
    ? {
        label: [
          stt.hasKey || stt.keySource ? "STT" : null,
          tts.hasKey || tts.keySource ? "TTS" : null,
        ]
          .filter(Boolean)
          .join(" + "),
        color: "success" as const,
      }
    : stt.keySource === "vault" || tts.keySource === "vault"
      ? { label: "Vault key", color: "primary" as const }
      : { label: "Not set" }

  return (
    <ConfigSection
      icon={<MicIcon />}
      title="Voice"
      description="Speech to text for the composer microphone and the voice that reads answers out loud in your browser. Workers AI reuses the Cloudflare vault key when no key is typed here."
      status={status}
    >
      <Stack spacing={1.5}>
        {error ? <Alert severity="error">{error}</Alert> : null}
        {saved ? <Alert severity="success">{saved}</Alert> : null}
        <Typography variant="subtitle2">Speech to text (microphone)</Typography>
        <Select
          name="stt-provider"
          label="STT provider"
          value={stt.provider}
          disabled={providers.length === 0}
          onSelect={(id) => pickSide("stt", id, stt, setStt)}
        >
          {[
            <option key="none" value="">
              Not set
            </option>,
            ...providers
              .filter((item) => item.kind === "stt")
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              )),
          ]}
        </Select>
        {sttSpec?.account ? (
          <TextField
            label={
              sttLocked
                ? `${sttSpec.account.label} (from vault)`
                : sttSpec.account.label
            }
            value={stt.accountId}
            placeholder={sttSpec.account.placeholder}
            disabled={sttLocked}
            onChange={(event) =>
              setStt({ ...stt, accountId: event.currentTarget.value })
            }
          />
        ) : null}
        {stt.provider ? (
          <>
            <Stack direction="row" spacing={1} alignItems="center">
              <TextField
                label={
                  sttLocked
                    ? "Using the vault key"
                    : stt.hasKey
                      ? `${sttSpec?.secret.label ?? "API key"} (blank keeps the saved key)`
                      : (sttSpec?.secret.label ?? "API key")
                }
                type={sttLocked ? undefined : "password"}
                value={sttLocked ? "" : stt.apiKey}
                placeholder={
                  sttLocked ? "••••••••" : sttSpec?.secret.placeholder
                }
                disabled={sttLocked}
                sx={{ flex: 1 }}
                onChange={(event) =>
                  setStt({ ...stt, apiKey: event.currentTarget.value })
                }
              />
              {sttLocked ? (
                <VaultOverrideButton onClick={sttVault.override} />
              ) : null}
            </Stack>
            <TextField
              label="STT model"
              value={stt.model}
              placeholder={sttSpec?.defaultModel}
              onChange={(event) =>
                setStt({ ...stt, model: event.currentTarget.value })
              }
            />
          </>
        ) : null}
        <Divider />
        <Typography variant="subtitle2">Text to speech (read aloud)</Typography>
        <Select
          name="tts-provider"
          label="TTS provider"
          value={tts.provider}
          disabled={providers.length === 0}
          onSelect={(id) => pickSide("tts", id, tts, setTts)}
        >
          {[
            <option key="none" value="">
              Not set
            </option>,
            ...providers
              .filter((item) => item.kind === "tts")
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              )),
          ]}
        </Select>
        {tts.provider ? (
          <>
            {ttsSpec?.account ? (
              <TextField
                label={
                  ttsLocked
                    ? `${ttsSpec.account.label} (from vault)`
                    : ttsSpec.account.label
                }
                value={tts.accountId}
                placeholder={ttsSpec.account.placeholder}
                disabled={ttsLocked}
                onChange={(event) =>
                  setTts({ ...tts, accountId: event.currentTarget.value })
                }
              />
            ) : null}
            <Stack direction="row" spacing={1} alignItems="center">
              <TextField
                label={
                  ttsLocked
                    ? "Using the vault key"
                    : tts.hasKey
                      ? `${ttsSpec?.secret.label ?? "API key"} (blank keeps the saved key)`
                      : (ttsSpec?.secret.label ?? "API key")
                }
                type={ttsLocked ? undefined : "password"}
                value={ttsLocked ? "" : tts.apiKey}
                placeholder={
                  ttsLocked ? "••••••••" : ttsSpec?.secret.placeholder
                }
                disabled={ttsLocked}
                sx={{ flex: 1 }}
                onChange={(event) =>
                  setTts({ ...tts, apiKey: event.currentTarget.value })
                }
              />
              {ttsLocked ? (
                <VaultOverrideButton onClick={ttsVault.override} />
              ) : null}
            </Stack>
            {ttsSpec?.modelOptional ? null : (
              <TextField
                label="TTS model"
                value={tts.model}
                placeholder={ttsSpec?.defaultModel}
                onChange={(event) =>
                  setTts({ ...tts, model: event.currentTarget.value })
                }
              />
            )}
            <TextField
              label="Voice"
              value={tts.voice}
              placeholder={ttsSpec?.defaultVoice || "default"}
              onChange={(event) =>
                setTts({ ...tts, voice: event.currentTarget.value })
              }
            />
          </>
        ) : null}
        <Select
          name="voice-language"
          label="Language"
          value={language}
          onSelect={(value) => {
            setLanguage(value)
            setSaved("")
          }}
        >
          {LANGUAGES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <Stack direction="row" spacing={1}>
          <Button
            variant="contained"
            disabled={busy || (!stt.provider && !tts.provider)}
            onClick={() => void save()}
          >
            Save voice
          </Button>
          {anyKey || stt.provider || tts.provider ? (
            <Button
              variant="text"
              disabled={busy}
              onClick={() => void remove()}
            >
              Remove
            </Button>
          ) : null}
        </Stack>
      </Stack>
    </ConfigSection>
  )
}
