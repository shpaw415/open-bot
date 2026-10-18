import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App"
import "./app.css"
import { ThemeModeProvider } from "./theme"

const head = (tag: string, attrs: Record<string, string>) => {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
  document.head.appendChild(el)
}

head("meta", { name: "theme-color", content: "#0e1014" })
head("link", { rel: "icon", href: "/favicon.ico", sizes: "48x48" })
head("link", {
  rel: "icon",
  href: "/icons/icon-192.png",
  sizes: "192x192",
  type: "image/png",
})
head("link", { rel: "apple-touch-icon", href: "/icons/apple-touch-icon.png" })
head("link", { rel: "manifest", href: "/manifest.webmanifest" })

const root = document.getElementById("root")
if (!root) throw new Error("missing root")

createRoot(root).render(
  <StrictMode>
    <ThemeModeProvider>
      <App />
    </ThemeModeProvider>
  </StrictMode>,
)
