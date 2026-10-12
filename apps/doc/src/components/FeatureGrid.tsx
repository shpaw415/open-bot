/**
 * Feature grid for the landing page.
 * Used directly in MDX (the home page is NOT wrapped in prose,
 * so this component owns all of its styling with Tailwind utilities).
 */

export interface Feature {
  title: string
  description: string
  icon?: string
}

export function FeatureGrid({ features }: { features: Feature[] }) {
  return (
    <div className="not-prose grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {features.map((feature) => (
        <div
          key={feature.title}
          className="rounded-xl border border-border bg-card p-5 transition-colors hover:bg-card-hover"
        >
          {feature.icon && (
            <div className="mb-3 text-2xl" aria-hidden="true">
              {feature.icon}
            </div>
          )}
          <h3 className="text-base font-semibold text-foreground">
            {feature.title}
          </h3>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">
            {feature.description}
          </p>
        </div>
      ))}
    </div>
  )
}

export default FeatureGrid
