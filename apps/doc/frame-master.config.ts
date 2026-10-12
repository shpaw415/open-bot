import type { FrameMasterConfig } from "frame-master/server/types"
import ApplyReact from "frame-master-plugin-apply-react/plugin"
import mdxLoader from "frame-master-plugin-mdx-to-js-loader"
import ReactToHtml from "frame-master-plugin-react-to-html"
import TailwindPlugin from "frame-master-plugin-tailwind"
import rehypePrettyCode from "rehype-pretty-code"
import remarkGfm from "remark-gfm"

export default {
  HTTPServer: {
    port: 3001,
  },
  plugins: [
    ReactToHtml({
      shellPath: "src/shell.tsx",
      srcDir: "src/pages",
      entrypointExtensions: [".tsx", ".mdx"],
    }),
    ApplyReact({
      clientShellPath: "src/client-wrapper.tsx",
      route: "src/pages",
      style: "nextjs",
      entrypointExtensions: [".tsx", ".mdx"],
    }),
    mdxLoader({
      mdxOptions: {
        remarkPlugins: [remarkGfm],
        rehypePlugins: [
          [
            rehypePrettyCode,
            {
              theme: {
                dark: "one-dark-pro",
                light: "github-light",
              },
              keepBackground: false,
            },
          ],
        ],
      },
    }),
    TailwindPlugin({
      inputFile: "static/tailwind.css",
      outputFile: "static/style.css",
    }),
    {
      name: "static-assets",
      version: "1.0.0",
      build: {
        buildConfig: {
          naming: {
            asset: "[dir]/[name].[ext]",
          },
        },
      },
    },
  ],
} satisfies FrameMasterConfig
