// Loose local types for the apply-react router package. The real package
// ships runtime .ts sources that are not tsc-clean outside its own build;
// the client shell only needs these shapes.
export type router = {
  match: (input: unknown) => { name?: string; pathname: string } | null
}
export const router: router = { match: () => null }
export function RouterHost(input: {
  onRouteChange: (match: { name?: string; pathname: string }) => Promise<void>
  children: any
}): any {
  return input.children
}
