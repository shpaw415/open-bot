import { join } from "node:path"
import { getBuilder } from "frame-master/build"
import type { FrameMasterPlugin } from "frame-master/plugin"
import { BuildUnifier } from "frame-master/plugin"
import type { FrameMasterConfig } from "frame-master/server/types"
import { isBuildMode, isProd } from "frame-master/utils"
import ApplyReact from "frame-master-plugin-apply-react/plugin"
import AssetsToBuild from "frame-master-plugin-assets-to-build"
import AutoSiteMap from "frame-master-plugin-auto-sitemap"
import SSRPlugin from "frame-master-plugin-cloudflare-pages-dynamic-ssr"
import CFActionPlugin from "frame-master-plugin-cloudflare-pages-functions-action"
import CloudflareUpdateManager from "frame-master-plugin-cloudflare-update-manager"
import CloudflareRouteFilePlugin from "frame-master-plugin-cloudflare-route-file-generator"
import NodePolyfills from "frame-master-plugin-node-polyfills"
import ReactToHTML from "frame-master-plugin-react-to-html"
import SEOPlugin from "frame-master-plugin-seo"
import ServeFromBuild from "frame-master-plugin-serve-from-build"
import TailwindPlugin from "frame-master-plugin-tailwind"
import { createElement } from "react"
import { renderToString } from "react-dom/server"
import SiteConfig from "./site.config"
import NotFound from "./src/components/404"
import AsyncFallback from "./src/components/loading"

const WranglerServerPort = Number(process.env.WRANGLER_PORT)

const cwd = process.cwd()

const nodePolyfillPlugin = NodePolyfills()

const catchAllPatch: FrameMasterPlugin = {
  name: "catchall-manager",
  version: "1.0.0",
  build: {
    buildConfig: {
      plugins: [
        {
          name: "catchall-entrypoint",
          setup(build) {
            build.onResolve(
              { filter: /\[\.\.\..*\]\.(tsx|jsx)/, namespace: "file" },
              (args) => {
                return {
                  path: args.path.includes("@apply-react/routes")
                    ? join(
                        cwd,
                        "src/pages",
                        args.path.replace("@apply-react/routes/", ""),
                      )
                    : args.path,
                  namespace: "catchall",
                }
              },
            )
            build.onLoad(
              { filter: /.*/, namespace: "catchall" },
              async (args) => {
                return {
                  contents:
                    args.__chainedContents ||
                    (await Bun.file(args.path).text()),
                  loader: "tsx",
                }
              },
            )
          },
        },
      ],
    },
  },
}

export default {
  HTTPServer: {
    port: 3000,
  },
  pluginsOptions: {
    skipRequirementsCheck: true,
  },
  plugins: [
    {
      name: "dev-plugin",
      version: "1.0.0",
      fileSystemWatchDir: ["src"],
      async onFileSystemChange(_ev, _fp, abs) {
        const builder = getBuilder()
        if (!abs.startsWith("src/") || builder?.isBuilding()) return
        await builder?.build()
      },
      serverStart: {
        dev_main() {
          if (!process.env.WRANGLER_PORT && !isBuildMode()) {
            console.error(
              "Rename .env.exemple to .env and set WRANGLER_PORT to your wrangler dev port.",
            )
            process.exit(1)
          }
        },
      },
    },
    catchAllPatch,
    nodePolyfillPlugin,
    ApplyReact({
      route: "src/pages",
      clientShellPath: "src/client-shell.tsx",
      entrypointExtensions: SiteConfig.frameworkConfig.routesExtensions,
      style: "nextjs",
      fallbacks: {
        defaultLoadingComponentPath: "src/components/loading.tsx",
        defaultNotFoundComponentPath: "src/components/404.tsx",
      },
      hydration: "hydrate",
    }),
    ReactToHTML({
      verbose: false,
      srcDir: "src/pages",
      shellPath: "src/shell.tsx",
      entrypointExtensions: SiteConfig.frameworkConfig.routesExtensions,
      asyncFallback: AsyncFallback,
      exclude: [
        /.*layout\.(tsx|jsx)$/,
        /.*404\.(tsx|jsx)$/,
        /.*loading\.(tsx|jsx)$/,
      ],
    }),
    ...BuildUnifier({
      label: "cloudflare-pages-functions",
      plugins: [
        CFActionPlugin({
          actionBasePath: "src/actions",
          outDir: ".frame-master/build",
          serverPort: WranglerServerPort,
        }),
        CloudflareUpdateManager({
          paths: {
            notFound: () => renderToString(createElement(NotFound)),
            actionBasePath: "src/actions",
          },
          autoInjectCheckVersion: true,
        }),
        SSRPlugin({
          actionBasePath: "src/actions",
          basePath: "src/pages",
          wrangler: {
            port: WranglerServerPort,
          },
          entrypointMatcher: [/.*layout\.tsx$/],
        }),
        {
          name: "env-vars-in-build",
          version: "1.0.0",
          virtualModules: {
            "@cf-process-env.js": {
              contents: `
                globalThis.process ??= {}; process.env ??= ${JSON.stringify({
                  NODE_ENV: process.env.NODE_ENV,
                  ...Object.fromEntries(
                    Object.entries(process.env).filter(([key]) =>
                      key.startsWith("PUBLIC_"),
                    ),
                  ),
                })};`,
              injectRuntime: true,
              loader: "js",
            },
          },
        },
      ],
    }),
    ServeFromBuild({
      buildDir: ".frame-master/build",
      plainURLPaths: ["index.html"],
      buildOnDevStart: true,
    }),
    TailwindPlugin({
      inputFile: "static/tailwind.css",
      outputFile: "static/style.css",
      options: {
        autoInjectInBuild: true,
        runtime: "bun",
      },
    }),
    AssetsToBuild({
      paths: [
        { src: "static/favicon.ico", dist: "favicon.ico" },
        { src: "robots.txt", dist: "robots.txt" },
      ],
    }),
    SEOPlugin(SiteConfig.SEO),
    AutoSiteMap({
      baseUrl: SiteConfig.siteUrl,
      authorizedExtensions: ["html"],
    }),
    {
      name: "optimization-plugin",
      version: "1.0.0",
      build: {
        buildConfig: {
          minify: isProd(),
          splitting: true,
          naming: {
            asset: "[dir]/[name].[ext]",
          },
        },
      },
    },
    ...(isProd()
      ? ([
          CloudflareRouteFilePlugin({
            routeOptions: () => ({
              version: 1,
              include: ["/*"],
              exclude: [
                "/static/*",
                "/favicon.ico",
                "/robots.txt",
                "/@cf-process-env.js",
                "/@dynamic-ssr-endpoints.js",
                "/chunks/*",
              ],
            }),
          }),
        ] as Array<FrameMasterPlugin>)
      : ([
          {
            name: "proxy-to-wrangler",
            version: "0.1.0",
            serverConfig: {
              routes: {
                "/*": async (req) => {
                  const url = new URL(req.url)
                  url.port = String(WranglerServerPort)
                  url.hostname = "127.0.0.1"
                  const headers = new Headers(req.headers)
                  headers.set("host", `127.0.0.1:${WranglerServerPort}`)
                  headers.delete("accept-encoding")
                  const hasBody =
                    req.method !== "GET" &&
                    req.method !== "HEAD" &&
                    req.body !== null
                  try {
                    const response = await fetch(url, {
                      method: req.method,
                      headers,
                      body: hasBody ? req.body : undefined,
                      redirect: "manual",
                    })
                    response.headers.delete("content-encoding")
                    return response
                  } catch {
                    return new Response("Bad Gateway: upstream unavailable", {
                      status: 502,
                    })
                  }
                },
              },
            },
            build: {
              buildConfig: {
                splitting: true,
              },
            },
            async serverReady({ builder }) {
              await builder.build()
            },
          },
        ] as Array<FrameMasterPlugin>)),
  ],
} satisfies FrameMasterConfig
