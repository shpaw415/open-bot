const KEY = "ob-notify-sound"

export function readNotifySound(): boolean {
  try {
    return localStorage.getItem(KEY) !== "0"
  } catch {
    return true
  }
}

export function writeNotifySound(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "1" : "0")
  } catch {}
}

let ctx: AudioContext | null = null

function note(ac: AudioContext, at: number, freq: number) {
  const osc = ac.createOscillator()
  const gain = ac.createGain()
  osc.type = "sine"
  osc.frequency.value = freq
  gain.gain.setValueAtTime(0, at)
  gain.gain.linearRampToValueAtTime(0.15, at + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.3)
  osc.connect(gain)
  gain.connect(ac.destination)
  osc.start(at)
  osc.stop(at + 0.32)
}

export function playNotifySound() {
  if (!readNotifySound()) return
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext
    if (!Ctor) return
    if (!ctx) ctx = new Ctor()
    if (ctx.state === "suspended") void ctx.resume().catch(() => {})
    const now = ctx.currentTime
    note(ctx, now, 659.25)
    note(ctx, now + 0.12, 880)
  } catch {}
}
