import { RouterHost, type router } from "frame-master-plugin-apply-react/router"
import { SSRPropsProvider } from "frame-master-plugin-cloudflare-pages-dynamic-ssr/client/context"
import type { PropsData } from "frame-master-plugin-cloudflare-pages-dynamic-ssr/provider/utils"
import { type JSX, StrictMode, useCallback, useRef, useState } from "react"

export default function ClientWrapper({ children }: { children: JSX.Element }) {
  const routeChangePromiseRef = useRef<
    ReturnType<typeof Promise.withResolvers<Array<PropsData> | null>>
  >(Promise.withResolvers<Array<PropsData> | null>())
  const resetRouteChangePromise = useCallback(
    (ref: typeof routeChangePromiseRef) => {
      ref.current.resolve?.(null)
      ref.current = Promise.withResolvers<Array<PropsData> | null>()
    },
    [],
  )
  const [pathname, setPathname] = useState(window.location.pathname)
  const [devKey, setDevKey] = useState(0)
  const matched = useRef<ReturnType<typeof router.match>>(null)

  return (
    <StrictMode>
      <SSRPropsProvider
        pathname={pathname}
        afterFetchCallback={() =>
          resetRouteChangePromise(routeChangePromiseRef)
        }
        devKey={devKey}
        fetchCallback={(_, dynamicEndpoints) => {
          const res = Boolean(
            matched.current?.name &&
              dynamicEndpoints.includes(matched.current.name),
          )
          if (!res) resetRouteChangePromise(routeChangePromiseRef)
          return res
        }}
      >
        <RouterHost
          onRouteChange={async (match) => {
            matched.current = match
            setPathname(match.pathname)
            if (process.env.NODE_ENV === "development") {
              setDevKey((prev) => prev + 1)
            }
            await routeChangePromiseRef.current.promise
          }}
        >
          {children}
        </RouterHost>
      </SSRPropsProvider>
    </StrictMode>
  )
}
