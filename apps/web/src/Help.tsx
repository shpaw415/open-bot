import Box from "@shpaw415/mui-lite/Box"
import Button from "@shpaw415/mui-lite/Button"
import Typography from "@shpaw415/mui-lite/Typography"
import Stack from "./stack"
import { NAV } from "./texts"

type HelpEntry = {
  question: string
  answer: string
  action?:
    | { label: string; path: string }
    | { label: string; kind: "new-thread" }
}

const ENTRIES: HelpEntry[] = [
  {
    question: "Commencer une tâche",
    answer:
      "Depuis l’accueil ou cette page, choisissez « Nouvelle conversation » et décrivez votre objectif en une ou deux phrases. Open-bot vous demande les informations manquantes au fur et à mesure. Un modèle doit être sélectionné dans les paramètres pour que les réponses fonctionnent.",
    action: { label: "Nouvelle conversation", kind: "new-thread" },
  },
  {
    question: "Donner du contexte à l’assistant",
    answer:
      "Dans la zone de message, le bouton « Ajouter un contexte » permet de joindre un projet, un fichier ou une application à votre demande. Vous pouvez aussi taper @ pour référencer un élément par son nom.",
  },
  {
    question: "Applications et extensions",
    answer:
      "Les applications ajoutent une interface utilisable; les extensions ajoutent des capacités aux conversations, parfois sans interface. Installez-les depuis la section Extensions (confirmation et permissions affichées avant l’installation).",
    action: { label: "Gérer les extensions", path: "/config/plugins" },
  },
  {
    question: "Automatisations",
    answer:
      "Une automatisation exécute une instruction selon un horaire : une seule fois à une date précise, ou à intervalle régulier (minutes, heures, jours). Les expressions cron (fuseau UTC) restent disponibles dans les options avancées.",
    action: { label: "Ouvrir les automatisations", path: "/automations" },
  },
  {
    question: "Projets et fichiers",
    answer:
      "Un projet regroupe des fichiers dans l’espace de travail Open-bot — pas sur votre ordinateur personnel. L’éditeur intégré permet de les modifier; vos changements non enregistrés sont signalés avant toute sortie.",
    action: { label: "Ouvrir les projets", path: "/projects" },
  },
  {
    question: "Médias",
    answer:
      "Les images, vidéos et modèles 3D produits dans les conversations sont archivés dans le coffre à médias. Supprimer un élément retire la copie enregistrée; le fichier original du bureau n’est retiré que si vous cochez l’option explicite.",
    action: { label: "Ouvrir les médias", path: "/media" },
  },
  {
    question: "Environnement en veille",
    answer:
      "L’environnement de travail s’endort quand il n’est pas utilisé pour économiser les ressources. Vos conversations sont conservées. Son démarrage suit toujours une action explicite de votre part : le bouton de démarrage, l’envoi d’un message, ou l’ouverture d’une application qui en a besoin.",
  },
  {
    question: "En cas de blocage",
    answer:
      "Un message d’erreur explique ce qui a échoué et propose une reprise. Si une liste reste vide, le bouton « Réessayer » recharge la source concernée. Pour un problème de compte (mot de passe, invitation, quota), contactez l’administrateur de votre instance Open-bot.",
  },
]

export function Help({
  go,
  onNewThread,
}: {
  go: (path: string) => void
  onNewThread: (seed?: string) => void
}) {
  return (
    <Box className="ob-scroll ob-view-enter" sx={{ flex: 1, minHeight: 0 }}>
      <Stack
        spacing={2}
        sx={{ p: { xs: 1.5, sm: 3 }, maxWidth: 720, mx: "auto", width: "100%" }}
      >
        <Typography variant="h5" component="h1">
          {NAV.help}
        </Typography>
        <Typography variant="body2" color="textSecondary">
          Open-bot est un assistant qui travaille pour vous : conversations,
          fichiers, applications et tâches programmées, dans un environnement
          qui lui est propre.
        </Typography>
        {ENTRIES.map((entry) => (
          <Box key={entry.question}>
            <Typography
              variant="subtitle1"
              component="h2"
              sx={{ fontSize: "1rem", fontWeight: 600 }}
            >
              {entry.question}
            </Typography>
            <Typography variant="body2" sx={{ mt: 0.5 }}>
              {entry.answer}
            </Typography>
            {entry.action ? (
              <Button
                size="small"
                variant="text"
                onClick={() => {
                  const action = entry.action
                  if (!action) return
                  if ("kind" in action && action.kind === "new-thread")
                    onNewThread()
                  else if ("path" in action) go(action.path)
                }}
                sx={{ mt: 0.5 }}
              >
                {entry.action.label}
              </Button>
            ) : null}
          </Box>
        ))}
      </Stack>
    </Box>
  )
}
