import { useEffect, useState } from "react"
import { Button, Spinner } from "../components/ui"

export default function Login() {
  const [state, setState] = useState<"checking" | "guest" | "signed-in">(
    "checking",
  )

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
    <div className="grid min-h-screen place-items-center bg-[#05070A] px-5 text-[#EDF2F7] antialiased">
      <div className="w-full max-w-[380px] rounded-[14px] border border-[#1D2735] bg-[#0F141D] p-8 text-center shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06),0_8px_30px_-12px_rgba(0,0,0,0.7)]">
        <Spinner size="size-8" />
        <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.14em] text-[#8B9CB8]">
          {state === "signed-in"
            ? "Signing you in…"
            : "Redirecting to sign-in…"}
        </p>
        <h1 className="mt-2 text-[18px] font-bold tracking-[-0.01em] text-[#EDF2F7]">
          Contacting identity
        </h1>
        <Button size="lg" className="mt-5 w-full" onClick={() => window.location.assign("/api/auth/login")}>
          Sign in
        </Button>
        <p className="mt-3 text-[13px] text-[#5B6B84]">
          You'll be redirected back automatically.
        </p>
        <a
          href="/"
          className="mt-4 inline-block text-[14px] font-semibold text-[#C8FF2E] underline-offset-4 decoration-[#C8FF2E]/40 hover:underline"
        >
          Browse plugins
        </a>
      </div>
    </div>
  )
}
