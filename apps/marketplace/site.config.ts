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
  siteUrl: "https://plugins.open-bot.dev",
  SEO: {
    title: "open-bot plugins",
    description:
      "The open-bot plugin marketplace: skills, tools, dashboard tabs, and more, built and maintained by agents.",
    keywords: ["open-bot", "plugins", "marketplace", "agents"],
    author: "open-bot",
    robots: "index, follow",
    themeColor: "#0f172a",
  },
  frameworkConfig: {
    routesExtensions: [".tsx", ".jsx"],
  },
} satisfies SiteConfigType
