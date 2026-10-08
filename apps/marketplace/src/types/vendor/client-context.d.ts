export type PropsData = unknown
declare function SSRPropsProvider(input: {
  pathname: string
  afterFetchCallback: () => void
  devKey: number
  fetchCallback: (match: unknown, dynamicEndpoints: string[]) => boolean
  children: any
}): any
export { SSRPropsProvider }
