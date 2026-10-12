/**
 * Site Configuration
 * Documentation for open-bot, the self-hosted conversational bot with an operated desktop.
 */
export const siteConfig = {
  /** The name of your project/site */
  name: "open-bot docs",

  /** Short description of your project */
  description:
    "Documentation for open-bot, the self-hosted conversational bot with an operated desktop.",

  /** The base URL of your site (used for SEO and social sharing) */
  url: "https://docs.open-bot.app",

  /** Author information */
  author: {
    name: "open-bot",
    url: "https://github.com/shpaw415/open-bot",
  },

  /** Social links displayed in the header/footer */
  links: {
    github: "https://github.com/shpaw415/open-bot",
    twitter: "",
    discord: "", // Leave empty to hide
  },

  /** Navigation items for the header */
  nav: [
    { label: "Home", href: "/" },
    { label: "Docs", href: "/docs" },
  ],

  /** Footer navigation sections */
  footer: {
    sections: [
      {
        title: "Documentation",
        links: [
          { label: "Introduction", href: "/docs" },
          { label: "Setup", href: "/docs/setup" },
          { label: "Architecture", href: "/docs/architecture" },
        ],
      },
      {
        title: "Community",
        links: [
          {
            label: "GitHub",
            href: "https://github.com/shpaw415/open-bot",
          },
        ],
      },
    ],
    copyright: `© ${new Date().getFullYear()} open-bot. All rights reserved.`,
  },

  /** Theme configuration */
  theme: {
    /** Default theme: "light", "dark", or "system" */
    defaultTheme: "dark" as "light" | "dark" | "system",

    /** Accent color used for links, buttons, etc. */
    accentColor: "#8b5cf6", // warm violet

    /** Dark theme colors */
    dark: {
      background: "#0a0a0a",
      foreground: "#fafafa",
      muted: "#a1a1aa",
      border: "#27272a",
      card: "#18181b",
      cardHover: "#27272a",
    },

    /** Light theme colors */
    light: {
      background: "#ffffff",
      foreground: "#0a0a0a",
      muted: "#71717a",
      border: "#e4e4e7",
      card: "#f4f4f5",
      cardHover: "#e4e4e7",
    },
  },

  /** SEO defaults */
  seo: {
    titleTemplate: "%s | open-bot docs",
    defaultTitle: "open-bot docs",
    openGraph: {
      type: "website",
      locale: "en_US",
      siteName: "open-bot docs",
    },
  },
} as const

export const docsNav: {
  group: string
  items: { label: string; href: string }[]
}[] = [
  {
    group: "Getting started",
    items: [
      { label: "Introduction", href: "/docs" },
      { label: "Setup", href: "/docs/setup" },
      { label: "Updating", href: "/docs/updating" },
    ],
  },
  {
    group: "Architecture",
    items: [
      { label: "Overview", href: "/docs/architecture" },
      { label: "Control plane", href: "/docs/control-plane" },
      { label: "Desktop containers", href: "/docs/desktop" },
      { label: "Web dashboard", href: "/docs/dashboard" },
    ],
  },
  {
    group: "Features",
    items: [
      { label: "Voice", href: "/docs/voice" },
      { label: "Media vault", href: "/docs/media-vault" },
      { label: "Thread preview", href: "/docs/thread-preview" },
      { label: "Product reports", href: "/docs/product-reports" },
      { label: "Plugin reports", href: "/docs/plugin-reports" },
    ],
  },
  {
    group: "Desktop agent",
    items: [
      { label: "Overview", href: "/docs/agent" },
      { label: "Native apps", href: "/docs/native-apps" },
      { label: "Agent threads", href: "/docs/agent-threads" },
    ],
  },
  {
    group: "Desktop CLIs",
    items: [
      { label: "ob-plugin", href: "/docs/ob-plugin" },
      { label: "ob-system1", href: "/docs/ob-system1" },
      { label: "Other CLIs", href: "/docs/ob-misc" },
    ],
  },
  {
    group: "Extending",
    items: [
      { label: "Plugin system", href: "/docs/plugins" },
      { label: "Marketplace", href: "/docs/marketplace" },
    ],
  },
  {
    group: "Operations",
    items: [
      { label: "Configuration reference", href: "/docs/configuration" },
      { label: "OpenViking setup", href: "/docs/openviking" },
    ],
  },
]

/** Type exports for TypeScript support */
export type SiteConfig = typeof siteConfig
export type NavItem = (typeof siteConfig.nav)[number]
export type FooterSection = (typeof siteConfig.footer.sections)[number]
export type ThemeMode = "light" | "dark" | "system"
