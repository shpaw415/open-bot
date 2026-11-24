import Alert from "@shpaw415/mui-lite/Alert"
import Box from "@shpaw415/mui-lite/Box"
import Button from "@shpaw415/mui-lite/Button"
import { List, ListItemText } from "@shpaw415/mui-lite/List"
import { CircularProgress } from "@shpaw415/mui-lite/Progress"
import Select from "@shpaw415/mui-lite/Select"
import TextField from "@shpaw415/mui-lite/TextField"
import Typography from "@shpaw415/mui-lite/Typography"
import { useCallback, useEffect, useRef, useState } from "react"
import AccessibleDialog, {
  DialogActions,
  DialogContent,
  DialogTitle,
} from "./AccessibleDialog"
import { api } from "./api"
import { ContentCopyIcon, DeleteIcon } from "./icons"
import Stack from "./stack"
import { STATES, THREADS_UI } from "./texts"

export type ThreadRelayTarget = {
  id: string
  title: string
}

type RelayGrant = {
  id: string
  targetSessionId: string
  remainingUses: number
  createdAt: number
  expiresAt: number
  revokedAt: number | null
  lastUsedAt: number | null
}

type MintedRelayGrant = RelayGrant & { token: string }

const TTL_OPTIONS = [15, 60, 240, 1440]

function grantStatus(grant: RelayGrant, now: number): string {
  if (grant.revokedAt !== null) return THREADS_UI.voiceRelayRevoked
  if (grant.expiresAt <= now) return THREADS_UI.voiceRelayExpired
  if (grant.remainingUses <= 0) return THREADS_UI.voiceRelayUsed
  return THREADS_UI.voiceRelayReady
}

function grantActive(grant: RelayGrant, now: number): boolean {
  return (
    grant.revokedAt === null && grant.expiresAt > now && grant.remainingUses > 0
  )
}

export function ThreadRelayDialog({
  target,
  onClose,
}: {
  target: ThreadRelayTarget | null
  onClose: () => void
}) {
  const [grants, setGrants] = useState<RelayGrant[]>([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [revokingId, setRevokingId] = useState("")
  const [ttlMinutes, setTtlMinutes] = useState(60)
  const [maxUses, setMaxUses] = useState(1)
  const [token, setToken] = useState("")
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState("")
  const requestRef = useRef(0)

  const load = useCallback(async (targetId: string) => {
    const seq = ++requestRef.current
    setLoading(true)
    setError("")
    try {
      const body = await api<{ grants: RelayGrant[] }>(
        `/api/threads/${encodeURIComponent(targetId)}/relay-grants`,
      )
      if (requestRef.current === seq) setGrants(body.grants ?? [])
    } catch {
      if (requestRef.current === seq) setError(THREADS_UI.voiceRelayLoadFailed)
    } finally {
      if (requestRef.current === seq) setLoading(false)
    }
  }, [])

  useEffect(() => {
    setToken("")
    setCopied(false)
    setTtlMinutes(60)
    setMaxUses(1)
    if (target) void load(target.id)
  }, [target, load])

  async function create() {
    if (!target || creating) return
    setCreating(true)
    setError("")
    try {
      const minted = await api<MintedRelayGrant>(
        `/api/threads/${encodeURIComponent(target.id)}/relay-grants`,
        {
          method: "POST",
          body: JSON.stringify({ ttlMinutes, maxUses }),
        },
      )
      setToken(minted.token)
      setCopied(false)
      const { token: _shownOnce, ...grant } = minted
      setGrants((current) => [grant, ...current])
    } catch {
      setError(THREADS_UI.voiceRelayCreateFailed)
    } finally {
      setCreating(false)
    }
  }

  async function revoke(id: string) {
    if (revokingId) return
    setRevokingId(id)
    setError("")
    try {
      const revoked = await api<RelayGrant>(
        `/api/thread-relay-grants/${encodeURIComponent(id)}`,
        { method: "DELETE" },
      )
      setGrants((current) =>
        current.map((grant) => (grant.id === id ? revoked : grant)),
      )
    } catch {
      setError(THREADS_UI.voiceRelayRevokeFailed)
    } finally {
      setRevokingId("")
    }
  }

  async function copyToken() {
    try {
      await navigator.clipboard.writeText(token)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  if (!target) return null
  const now = Date.now()
  const titleId = `thread-relay-title-${target.id}`

  return (
    <AccessibleDialog open onClose={onClose} aria-labelledby={titleId}>
      <DialogTitle id={titleId}>
        {THREADS_UI.voiceRelayTitle(target.title)}
      </DialogTitle>
      <DialogContent>
        <Stack
          spacing={2}
          sx={{ minWidth: { xs: "min(82vw, 420px)", sm: 460 } }}
        >
          <Typography variant="body2">{THREADS_UI.voiceRelayBody}</Typography>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
              gap: 2,
            }}
          >
            <Select
              name="relay-ttl"
              label={THREADS_UI.voiceRelayTtl}
              value={String(ttlMinutes)}
              onSelect={(value) => setTtlMinutes(Number(value))}
            >
              {TTL_OPTIONS.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {THREADS_UI.voiceRelayMinutes(minutes)}
                </option>
              ))}
            </Select>
            <TextField
              name="relay-max-uses"
              label={THREADS_UI.voiceRelayUses}
              type="number"
              value={String(maxUses)}
              onChange={(event) => {
                const next = Number(event.currentTarget.value)
                setMaxUses(
                  Number.isFinite(next)
                    ? Math.min(20, Math.max(1, Math.trunc(next)))
                    : 1,
                )
              }}
            />
          </Box>
          <Box>
            <Button
              variant="contained"
              onClick={() => void create()}
              disabled={creating}
              startIcon={creating ? <CircularProgress size={18} /> : undefined}
            >
              {creating
                ? THREADS_UI.voiceRelayCreating
                : THREADS_UI.voiceRelayCreate}
            </Button>
          </Box>
          {token ? (
            <Stack spacing={1}>
              <TextField
                label={THREADS_UI.voiceRelayHandle}
                value={token}
                readOnly
                onChange={() => {}}
                onFocus={(event) => event.currentTarget.select()}
                sx={{ width: "100%" }}
              />
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <Button
                  type="button"
                  variant="outlined"
                  size="small"
                  startIcon={<ContentCopyIcon width={16} height={16} />}
                  onClick={() => void copyToken()}
                >
                  {copied
                    ? THREADS_UI.voiceRelayCopied
                    : THREADS_UI.voiceRelayCopy}
                </Button>
                <Typography variant="caption" color="textSecondary">
                  {THREADS_UI.voiceRelayOnce}
                </Typography>
              </Box>
            </Stack>
          ) : null}
          {error ? <Alert severity="error">{error}</Alert> : null}
          <Box>
            <Typography variant="subtitle2">
              {THREADS_UI.voiceRelayActive}
            </Typography>
            {loading ? (
              <CircularProgress size={22} sx={{ mt: 1 }} />
            ) : grants.length === 0 ? (
              <Typography variant="body2" color="textSecondary" sx={{ mt: 1 }}>
                {THREADS_UI.voiceRelayNone}
              </Typography>
            ) : (
              <List>
                {grants.map((grant) => (
                  <Box
                    key={grant.id}
                    sx={{ display: "flex", alignItems: "center", gap: 1 }}
                  >
                    <ListItemText
                      primary={`${grantStatus(grant, now)} · ${THREADS_UI.voiceRelayRemaining(grant.remainingUses)}`}
                      secondary={THREADS_UI.voiceRelayExpires(
                        new Date(grant.expiresAt).toLocaleString(),
                      )}
                    />
                    {grantActive(grant, now) ? (
                      <Button
                        type="button"
                        color="error"
                        size="small"
                        startIcon={<DeleteIcon width={16} height={16} />}
                        disabled={revokingId === grant.id}
                        onClick={() => void revoke(grant.id)}
                      >
                        {THREADS_UI.voiceRelayRevoke}
                      </Button>
                    ) : null}
                  </Box>
                ))}
              </List>
            )}
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button type="button" onClick={onClose}>
          {STATES.close}
        </Button>
      </DialogActions>
    </AccessibleDialog>
  )
}
