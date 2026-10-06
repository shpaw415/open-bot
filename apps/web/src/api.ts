export type Me = {
  id: string
  email: string
  role: "admin" | "user"
  mustChangePassword?: boolean
  desktop?: "starting" | "running" | "sleeping"
  model?: { providerID: string | null; modelID: string | null } | null
}

export function clientId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  })
  const body = (await response.json().catch(() => ({}))) as T & {
    error?: string
  }
  if (!response.ok) throw new Error(body.error ?? response.statusText)
  return body
}

export type DesktopStatus = {
  phase: "starting" | "running" | "sleeping"
  error?: string
}

export async function waitForDesktop(timeoutMs = 600_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (true) {
    const status = await api<DesktopStatus>("/api/desktop")
    if (status.error) throw new Error(status.error)
    if (status.phase === "running") return
    if (Date.now() > deadline)
      throw new Error("desktop did not start in time, try again")
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
}
