import { useEffect, useState } from "react"
import { Button, Spinner } from "../components/ui"

export default function Login() {
  // The state value is write-only: every branch redirects before rendering.
  const [, setState] = useState<"checking" | "guest" | "signed-in">("checking")

  useEffect(() => {
    let cancelled = false
    fetch("/api/auth/me")
      .then((res) => {
        if (cancelled) return null
        if (res.ok) {
          setState("signed-in")
          window.location.replace("/account")
          return null
        }
        setState("guest")
        window.location.replace("/api/auth/login")
        return null
      })
      .catch(() => {
        if (!cancelled) setState("guest")
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="grid min-h-[60vh] place-items-center px-4 py-16 text-ink">
      <div className="w-full max-w-[360px] rounded-(--radius-card) border border-line bg-surface p-8 text-center shadow-(--shadow-card)">
        <Spinner size="size-8" />
        <h1 className="mt-4 text-[18px] font-bold tracking-[-0.01em] text-ink">
          Signing you in
        </h1>
        <p className="mt-1 text-[13.5px] text-ink-2">
          You'll be redirected back automatically.
        </p>
        <Button
          size="lg"
          className="mt-5 w-full"
          onClick={() => window.location.assign("/api/auth/login")}
        >
          Sign in
        </Button>
        <a
          href="/"
          className="mt-4 inline-block text-[14px] font-semibold text-accent underline-offset-4 hover:underline"
        >
          Browse plugins
        </a>
      </div>
    </div>
  )
}
