import { useEffect, useRef } from "react"

export type OrbState = "idle" | "thinking" | "working"
type OrbMotion = {
  speed: number
  ripple: number
  pulse: number
  label: string
  sub: string
}
export type AgentOrbProps = {
  state: OrbState
  /** Whole animation area, including halo and orbit, in CSS pixels. */
  size?: number
  label?: string
  className?: string
}

const labels: Record<OrbState, string> = {
  idle: "Au repos",
  thinking: "Je réfléchis",
  working: "Je travaille",
}

/** Local canvas only. No network requests, dependencies or global styles. */
export default function AgentOrb({
  state,
  size = 112,
  label,
  className,
}: AgentOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stateRef = useRef<OrbState>(state)
  const redrawRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    stateRef.current = state
    redrawRef.current?.()
  }, [state])

  useEffect(() => {
    const element = canvasRef.current
    if (!element) return
    const canvas: HTMLCanvasElement = element
    const context = canvas.getContext("2d")
    if (!context) return
    const ctx: CanvasRenderingContext2D = context
    const states: Record<OrbState, OrbMotion> = {
      idle: {
        speed: 0.17,
        ripple: 0.022,
        pulse: 0.018,
        label: "À votre écoute",
        sub: "Prêt pour la suite.",
      },
      thinking: {
        speed: 0.48,
        ripple: 0.095,
        pulse: 0.045,
        label: "Je réfléchis",
        sub: "J’explore les possibilités…",
      },
      working: {
        speed: 0.94,
        ripple: 0.15,
        pulse: 0.025,
        label: "Je travaille",
        sub: "Je donne forme à votre demande…",
      },
    }
    let speed = 0.48,
      ripple = 0.095,
      pulse = 0.045
    let width = 600,
      height = 340,
      time = 0,
      last = 0,
      frame = 0
    // Requested palette: Open-Bot blue #3565d4 and pure white.
    const colors = [
      [53, 101, 212],
      [255, 255, 255],
    ]
    const motion = matchMedia("(prefers-reduced-motion: reduce)")
    const rgba = (c: number[], a: number) =>
      `rgba(${c.map(Math.round).join(",")},${a})`

    function resize() {
      if (!canvas) return
      const r = canvas.getBoundingClientRect()
      width = r.width
      height = r.height
      const dpr = Math.min(devicePixelRatio || 1, 2)
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      if (motion.matches) draw()
    }
    const points: { x: number; y: number; z: number; a: number; b: number }[] =
      []
    const n = 6400,
      golden = Math.PI * (3 - Math.sqrt(5))
    for (let i = 0; i < n; i++) {
      const y = 1 - (2 * (i + 0.5)) / n
      const r = Math.sqrt(1 - y * y),
        a = i * golden
      points.push({
        x: Math.cos(a) * r,
        y,
        z: Math.sin(a) * r,
        a,
        b: Math.acos(y),
      })
    }
    function draw() {
      ctx.clearRect(0, 0, width, height)
      const state = stateRef.current
      const target = states[state]
      if (motion.matches) {
        speed = target.speed
        ripple = target.ripple
        pulse = target.pulse
      }
      speed += (target.speed - speed) * 0.045
      ripple += (target.ripple - ripple) * 0.045
      pulse += (target.pulse - pulse) * 0.045
      const radius =
        Math.min(width * 0.32, 106) * (1 + Math.sin(time * 1.5) * pulse)
      const cx = width / 2,
        cy = height / 2 - 1
      const halo = ctx.createRadialGradient(
        cx,
        cy,
        radius * 0.45,
        cx,
        cy,
        radius * 1.6,
      )
      halo.addColorStop(0, rgba(colors[0], 0.055))
      halo.addColorStop(0.65, rgba(colors[1], 0.035))
      halo.addColorStop(1, rgba(colors[0], 0))
      ctx.fillStyle = halo
      ctx.fillRect(0, 0, width, height)
      const rotation = time * 0.22,
        tilt = 0.24 + Math.sin(time * 0.23) * 0.17
      const cr = Math.cos(rotation),
        sr = Math.sin(rotation),
        ct = Math.cos(tilt),
        st = Math.sin(tilt)
      const projected: { x: number; y: number; z: number; band: number }[] = []
      for (const p of points) {
        const wave =
          Math.sin(p.x * 5 + time * 1.7) * Math.cos(p.y * 4 - time * 0.9) +
          0.5 * Math.sin(p.z * 7 + time * 1.2)
        const rr = 1 + ripple * wave
        const x = (p.x * cr + p.z * sr) * rr
        const z0 = (-p.x * sr + p.z * cr) * rr
        const y = p.y * ct * rr - z0 * st,
          z = p.y * st * rr + z0 * ct
        const perspective = 3.8 / (3.8 - z)
        const band =
          0.5 + 0.5 * Math.sin(p.y * 9 + p.a * 0.6 - time * 1.9 + wave * 0.7)
        projected.push({
          x: cx + x * radius * perspective,
          y: cy + y * radius * perspective,
          z,
          band,
        })
      }
      projected.sort((a, b) => a.z - b.z)
      for (const p of projected) {
        const depth = (p.z + 1.3) / 2.6
        const mix = 0.5 + 0.5 * Math.sin((p.y / radius) * 1.8 + time * 0.3)
        const c = colors[0].map((v, i) => v * (1 - mix) + colors[1][i] * mix)
        const alpha = (0.12 + 0.62 * depth) * (0.3 + 0.7 * p.band ** 2)
        const size = 0.38 + 0.68 * depth + 0.32 * p.band
        ctx.fillStyle = rgba(c, alpha)
        ctx.beginPath()
        ctx.arc(p.x, p.y, size, 0, Math.PI * 2)
        ctx.fill()
      }
      // A subtle orbit carries the same motion beyond the particle surface.
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(-0.38 + Math.sin(time * 0.18) * 0.12)
      ctx.scale(1, 0.34)
      ctx.strokeStyle = rgba(colors[0], state === "idle" ? 0.06 : 0.13)
      ctx.lineWidth = 0.7
      ctx.beginPath()
      ctx.ellipse(0, 0, radius * 1.43, radius * 1.43, 0, 0, Math.PI * 2)
      ctx.stroke()
      if (state !== "idle") {
        const a = -time * 1.5
        ctx.strokeStyle = rgba(colors[1], 0.65)
        ctx.lineWidth = 1.8
        ctx.beginPath()
        ctx.ellipse(0, 0, radius * 1.43, radius * 1.43, 0, a, a + 0.28)
        ctx.stroke()
      }
      ctx.restore()
    }

    let raf = 0,
      visible = true,
      disposed = false
    function stop() {
      cancelAnimationFrame(raf)
      raf = 0
      last = 0
    }
    function tick(now: number) {
      raf = 0
      if (disposed || document.hidden || !visible) return
      const dt = last ? Math.min((now - last) / 1000, 0.05) : 0
      last = now
      time += dt * speed * 2
      if (now - frame >= 32) {
        draw()
        frame = now
      }
      if (!motion.matches) raf = requestAnimationFrame(tick)
    }
    function resume() {
      stop()
      if (disposed || document.hidden || !visible) return
      draw()
      if (!motion.matches) raf = requestAnimationFrame(tick)
    }
    const observer = new ResizeObserver(() => {
      resize()
      resume()
    })
    observer.observe(canvas)
    const intersection = new IntersectionObserver((entries) => {
      visible = entries.some((entry) => entry.isIntersecting)
      resume()
    })
    intersection.observe(canvas)
    document.addEventListener("visibilitychange", resume)
    motion.addEventListener("change", resume)
    redrawRef.current = () => {
      if (motion.matches) draw()
    }
    resize()
    resume()
    return () => {
      disposed = true
      stop()
      observer.disconnect()
      intersection.disconnect()
      document.removeEventListener("visibilitychange", resume)
      motion.removeEventListener("change", resume)
      redrawRef.current = null
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className={className}
      role="img"
      aria-label={label ?? labels[state]}
      style={{
        display: "block",
        width: size,
        height: size,
        maxWidth: "100%",
        flexShrink: 0,
      }}
    />
  )
}
