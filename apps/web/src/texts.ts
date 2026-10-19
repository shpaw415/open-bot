/**
 * Central fr-CA strings for the shell and the journeys this pass touches.
 * Deep expert screens keep their current copy; the persistent chrome
 * (navigation, header, login, search, states) speaks the user's language.
 * Identifiers (API fields, model ids, plugin names) are never translated.
 */

export const NAV = {
  home: "Accueil",
  chat: "Conversations",
  apps: "Applications",
  automations: "Automatisations",
  projects: "Projets",
  media: "Médias",
  settings: "Paramètres",
  help: "Aide",
  admin: "Administration",
} as const

export const BRAND = {
  /** Screen-reader line for the logo link — it now lands on Home. */
  logoLabel: "open-bot — aller à l’accueil",
  tagline:
    "Décrivez votre objectif. Open-bot vous aide à le réaliser et vous demande les informations nécessaires au bon moment.",
} as const

export const SEARCH = {
  placeholder: "Rechercher — Ctrl K",
  placeholderMobile: "Rechercher applications, conversations, projets…",
  ariaLabel:
    "Rechercher des destinations, applications, conversations et projets",
  scope:
    "Destinations, applications, titres de conversations et projets — pas le contenu des messages.",
  loading: "Chargement des conversations et projets…",
  /** Honest per-source failure lines; each keeps its own Retry. */
  conversationsUnavailable: "Conversations indisponibles.",
  conversationsAsleep:
    "Conversations indisponibles : l’environnement est en veille.",
  projectsUnavailable: "Projets indisponibles.",
  wake: "Démarrer l’environnement",
  clear: "Effacer la recherche",
} as const

export function noMatchText(query: string): string {
  return `Aucun résultat pour « ${query} ». ${SEARCH.scope}`
}

export const STATES = {
  retry: "Réessayer",
  cancel: "Annuler",
  close: "Fermer",
  delete: "Supprimer",
  edit: "Modifier",
  save: "Enregistrer",
  saving: "Enregistrement…",
  unsavedLeave:
    "Vous avez des modifications non enregistrées. Quitter cette page quand même?",
} as const

/** « Environnement prêt / En veille / Démarrage » — the desktop, not a task. */
export const DESKTOP_STATE_TEXT: Record<
  "running" | "sleeping" | "starting",
  { label: string; detail: string }
> = {
  running: {
    label: "Environnement prêt",
    detail: "L’espace de travail d’Open-bot est démarré.",
  },
  sleeping: {
    label: "En veille",
    detail:
      "L’environnement de travail est en veille. Démarrez-le pour discuter ou reprendre une conversation.",
  },
  starting: {
    label: "Démarrage en cours",
    detail: "L’environnement démarre. Cela peut prendre quelques minutes.",
  },
} as const

export const THREAD = {
  /** Generic untitled-thread label; the real title replaces it once named. */
  untitled: "Nouvelle conversation",
} as const
