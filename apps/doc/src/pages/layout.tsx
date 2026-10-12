import type React from "react"
import { Footer, Header, ThemeProvider } from "../components"

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <div className="min-h-screen flex flex-col selection:bg-accent/30">
        <Header />
        <main className="flex-1 w-full">{children}</main>
        <Footer />
      </div>
    </ThemeProvider>
  )
}
