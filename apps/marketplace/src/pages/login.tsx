import { useEffect, useState } from "react"

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
    <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
      <div className="text-center">
        <span className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-slate-700 border-t-blue-500" />
        <p className="mt-4 text-sm text-slate-400">
          {state === "signed-in"
            ? "Signed in — taking you to your account…"
            : "Redirecting to sign-in…"}
        </p>
        <button
          type="button"
          onClick={() => window.location.assign("/api/auth/login")}
          className="mt-4 inline-block rounded-full bg-blue-600 px-5 py-2 text-sm font-semibold hover:bg-blue-500"
        >
          Sign in
        </button>
        <a href="/" className="ml-3 text-sm text-slate-400 hover:underline">
          Browse plugins
        </a>
      </div>
    </div>
  )
}
