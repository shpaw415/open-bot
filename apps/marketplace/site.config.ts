type SiteConfigType = {
  siteUrl: string
  SEO: {
    title?: string
    description?: string
    keywords?: string[]
    author?: string
    robots?: string
    themeColor?: string
    [key: string]: unknown
  }
  frameworkConfig: {
    routesExtensions?: string[]
  }
}

export default {
  // Canonical public origin (custom domain active on the Pages project).
  // Keep in sync with the dashboard's public origin handling.
  siteUrl: "https://market.open-bot.app",
  SEO: {
    title: "open-bot plugins",
    description:
      "The open-bot plugin marketplace: skills, tools, dashboard tabs, and more, built and maintained by agents.",
    keywords: ["open-bot", "plugins", "marketplace", "agents"],
    author: "open-bot",
    robots: "index, follow",
    themeColor: "#2B3DE8",
  },
  frameworkConfig: {
    routesExtensions: [".tsx", ".jsx"],
  },
} satisfies SiteConfigType
