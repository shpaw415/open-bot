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
    <div className="grid min-h-screen place-items-center bg-[#FAFAF7] px-5 text-[#1A2333] antialiased">
      <div className="w-full max-w-[360px] rounded-[16px] border border-[#E7E2D6] bg-white p-8 text-center shadow-[0_1px_2px_rgba(26,35,51,0.05),0_8px_24px_-12px_rgba(26,35,51,0.12)]">
        <Spinner size="size-8" />
        <h1 className="mt-4 text-[18px] font-bold tracking-[-0.01em] text-[#1A2333]">
          Signing you in
        </h1>
        <p className="mt-1 text-[13.5px] text-[#5F6B80]">
          You'll be redirected back automatically.
        </p>
        <Button size="lg" className="mt-5 w-full" onClick={() => window.location.assign("/api/auth/login")}>
          Sign in
        </Button>
        <a
          href="/"
          className="mt-4 inline-block text-[14px] font-semibold text-[#2B3DE8] underline-offset-4 hover:underline"
        >
          Browse plugins
        </a>
      </div>
    </div>
  )
}
