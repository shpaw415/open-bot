import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App"
import "./app.css"
import { ThemeModeProvider } from "./theme"

const root = document.getElementById("root")
if (!root) throw new Error("missing root")

createRoot(root).render(
  <StrictMode>
    <ThemeModeProvider>
      <App />
    </ThemeModeProvider>
  </StrictMode>,
)
