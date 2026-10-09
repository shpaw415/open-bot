import Box from "@shpaw415/mui-lite/Box"
import { CircularProgress } from "@shpaw415/mui-lite/Progress"
import Stack from "@shpaw415/mui-lite/Stack"
import Typography from "@shpaw415/mui-lite/Typography"
import { useEffect, useRef, useState } from "react"
import type { Mesh, Object3D } from "three"
import { MediaDownloadButton } from "./MediaDownload"

export function Model3dView({ src, alt }: { src: string; alt?: string }) {
  const holder = useRef<HTMLDivElement | null>(null)
  const [state, setState] = useState<"loading" | "ready" | "error">("loading")

  useEffect(() => {
    const element = holder.current
    if (!element) return
    let disposed = false
    let frame = 0
    let cleanup: (() => void) | null = null

    setState("loading")
    void (async () => {
      try {
        const [three, { GLTFLoader }, { OrbitControls }] = await Promise.all([
          import("three"),
          import("three/examples/jsm/loaders/GLTFLoader.js"),
          import("three/examples/jsm/controls/OrbitControls.js"),
        ])
        if (disposed || !element) return

        const width = element.clientWidth || 320
        const height = element.clientHeight || 240
        const scene = new three.Scene()
        const camera = new three.PerspectiveCamera(
          45,
          width / height,
          0.1,
          5000,
        )
        const renderer = new three.WebGLRenderer({
          antialias: true,
          alpha: true,
        })
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
        renderer.setSize(width, height)
        element.appendChild(renderer.domElement)

        scene.add(new three.AmbientLight(0xffffff, 0.45))
        const key = new three.DirectionalLight(0xffffff, 2.2)
        key.position.set(2, 3, 4)
        scene.add(key)
        const fill = new three.DirectionalLight(0xffffff, 0.7)
        fill.position.set(-3, -1, -2)
        scene.add(fill)

        const controls = new OrbitControls(camera, renderer.domElement)
        controls.enableDamping = true
        controls.dampingFactor = 0.08

        const gltf = await new Promise<any>((resolve, reject) => {
          new GLTFLoader().load(src, resolve, undefined, reject)
        })
        if (disposed) return
        const root = gltf.scene as Object3D
        root.traverse((node) => {
          const mesh = node as Mesh
          if (!mesh.isMesh || !mesh.geometry) return
          const geometry = mesh.geometry
          if (!geometry.attributes.normal) geometry.computeVertexNormals()
          const materials = Array.isArray(mesh.material)
            ? mesh.material
            : [mesh.material]
          for (const material of materials) {
            const standard = material as any
            if (!standard?.isMeshStandardMaterial) continue
            if (!standard.vertexColors) standard.color?.set?.(0xffffff)
            standard.roughness ??= 0.65
            standard.metalness ??= 0.05
          }
        })
        scene.add(root)

        const box = new three.Box3().setFromObject(root)
        const sphere = box.getBoundingSphere(new three.Sphere())
        const center = sphere.center
        const radius = Math.max(sphere.radius, 0.001)
        camera.near = radius / 100
        camera.far = radius * 100
        camera.updateProjectionMatrix()
        camera.position.set(
          center.x + radius * 1.9,
          center.y + radius * 1.4,
          center.z + radius * 2.4,
        )
        controls.target.copy(center)
        controls.update()

        const resize = () => {
          const nextWidth = element.clientWidth || width
          const nextHeight = element.clientHeight || height
          camera.aspect = nextWidth / nextHeight
          camera.updateProjectionMatrix()
          renderer.setSize(nextWidth, nextHeight)
        }
        const observer = new ResizeObserver(resize)
        observer.observe(element)

        const tick = () => {
          frame = requestAnimationFrame(tick)
          controls.update()
          renderer.render(scene, camera)
        }
        tick()
        setState("ready")

        cleanup = () => {
          observer.disconnect()
          cancelAnimationFrame(frame)
          controls.dispose()
          root.traverse((node) => {
            const mesh = node as Mesh
            if (!mesh.isMesh) return
            mesh.geometry?.dispose()
            const materials = Array.isArray(mesh.material)
              ? mesh.material
              : [mesh.material]
            for (const material of materials) {
              const record = material as any
              for (const value of Object.values(record ?? {})) {
                if (value && typeof value === "object" && "isTexture" in value)
                  (value as any).dispose?.()
              }
              material?.dispose()
            }
          })
          renderer.dispose()
          renderer.domElement.remove()
        }
      } catch {
        if (!disposed) setState("error")
      }
    })()

    return () => {
      disposed = true
      cleanup?.()
    }
  }, [src])

  return (
    <Box
      className="ob-media-box"
      sx={{
        position: "relative",
        width: "100%",
        height: 300,
        borderRadius: 1,
        overflow: "hidden",
        border: "1px solid",
        borderColor: "divider",
        bgcolor: "background.default",
        touchAction: "none",
      }}
      title={alt || "3D model"}
    >
      <div
        ref={holder}
        style={{ position: "absolute", inset: 0 }}
        aria-label={alt || "3D model"}
        role="img"
      />
      <MediaDownloadButton src={src} />
      {state === "loading" ? (
        <Stack
          alignItems="center"
          justifyContent="center"
          sx={{ position: "absolute", inset: 0, pointerEvents: "none" }}
        >
          <CircularProgress size={26} />
        </Stack>
      ) : null}
      {state === "error" ? (
        <Stack
          alignItems="center"
          justifyContent="center"
          sx={{ position: "absolute", inset: 0, pointerEvents: "none" }}
        >
          <Typography variant="body2" color="textSecondary">
            Could not load this 3D model.
          </Typography>
        </Stack>
      ) : null}
    </Box>
  )
}
