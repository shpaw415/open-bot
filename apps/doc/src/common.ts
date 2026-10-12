/**
 * @deprecated Use `siteConfig` from `./site.config.ts` instead.
 * This file is kept for backward compatibility.
 */
import { siteConfig } from "./site.config"

export const APP_DATA = {
  projectName: siteConfig.name,
} as const

/** Re-export site config for convenience */
export { siteConfig } from "./site.config"
