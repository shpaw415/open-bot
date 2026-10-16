import Alert from "@shpaw415/mui-lite/Alert"
import { useEffect, useState } from "react"
import { fetchQuota, type QuotaState } from "./api"
import { quotaMeterView } from "./team"

export function QuotaMeter() {
  const [quota, setQuota] = useState<QuotaState | null>(null)
  useEffect(() => {
    let alive = true
    void fetchQuota()
      .then((body) => {
        if (alive) setQuota(body)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])
  const view = quotaMeterView(quota)
  if (!view.visible) return null
  return <Alert severity={view.severity}>{view.text}</Alert>
}
