import { siteConfig } from "./site.config"

// Script to prevent flash of wrong theme
const themeScript = `
(function() {
  const stored = localStorage.getItem('theme-mode');
  const defaultTheme = '${siteConfig.theme.defaultTheme}';
  const mode = stored || defaultTheme;
  let theme = mode;
  if (mode === 'system') {
    theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.classList.add(theme);
})();
`

export default function RenderShell({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="description" content={siteConfig.description} />
        <meta name="author" content={siteConfig.author.name} />
        <meta name="color-scheme" content="light dark" />

        {/* Open Graph / Social */}
        <meta property="og:type" content={siteConfig.seo.openGraph.type} />
        <meta
          property="og:site_name"
          content={siteConfig.seo.openGraph.siteName}
        />
        <meta property="og:title" content={siteConfig.seo.defaultTitle} />
        <meta property="og:description" content={siteConfig.description} />
        <meta property="og:locale" content={siteConfig.seo.openGraph.locale} />

        {/* Favicon - inline data URI so nested routes resolve it too */}
        <link
          rel="icon"
          type="image/png"
          href="data:image/png;base64,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"
        />

        <link rel="stylesheet" href="/static/style.css" />
        <title>{siteConfig.seo.defaultTitle}</title>

        {/* Theme initialization script - prevents flash */}
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: inline theme bootstrap, static string */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      {/* biome-ignore lint/correctness/useUniqueElementIds: apply-react mounts on #root */}
      <body
        id="root"
        className="bg-background text-foreground antialiased transition-colors"
      >
        {children}
      </body>
    </html>
  )
}
