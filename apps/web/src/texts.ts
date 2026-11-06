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

/** Daily-journey controls of the Conversations view and its composer. */
export const THREADS_UI = {
  listTitle: "Conversations",
  selectThreads: "Sélectionner les conversations",
  selectAll: "Tout sélectionner",
  deleteSelected: "Supprimer la sélection",
  cancelSelection: "Annuler la sélection",
  newFolder: "Nouveau dossier",
  newThread: "Nouvelle conversation",
  newThreadIn: (dir: string) => `Nouvelle conversation dans ${dir}`,
  filterLoaded: "Filtrer les conversations chargées",
  clearFilter: "Effacer le filtre de conversations",
  noThreadsYet: "Aucune conversation pour l’instant",
  selectAThread: "Choisissez une conversation",
  noMessagesYet: "Aucun message pour l’instant",
  messagesCatchingUp: "Chargement des nouveaux messages…",
  loadingMessages: "Chargement des messages…",
  messagesLoadFailed: "Impossible de charger les messages.",
  loadOlder: "Charger les messages plus anciens",
  loadingOlder: "Chargement des messages plus anciens…",
  olderLoadFailed: "Impossible de charger les messages plus anciens.",
  retry: "Réessayer",
  usingModel: (name: string) => `Avec ${name}. Demandez ce que vous voulez.`,
  pickModelFirst: "Choisissez un modèle, puis demandez ce que vous voulez.",
  startToChat: "Démarrez l’environnement pour discuter",
  startDesktop: "Démarrer l’environnement",
  holdToSpeak: "Maintenir pour parler",
  releaseToTranscribe: "Relâcher pour transcrire",
  readAloudOn: "Lire les réponses à voix haute : activé",
  readAloudOff: "Lire les réponses à voix haute : désactivé",
  readAloud: "Lire les réponses à voix haute",
  send: "Envoyer",
  sendMessage: "Envoyer le message",
  typeToPickApp: "Tapez pour choisir une application",
  openApp: "Ouvrir l’application",
  noSectionMatch: "Aucune section correspondante",
  noModelMatches: "Aucun modèle correspondant",
  searchModels: "Rechercher un modèle",
  desktopStopping: "L’environnement se met en veille. Attendez, puis renvoyez.",
  desktopNotReady:
    "L’environnement n’est pas prêt. Attendez qu’il fonctionne, puis renvoyez.",
  deleteFailed: "Échec de la suppression",
  renameFailed: "Échec du renommage",
  newThreadFailed: "Échec de la création de la conversation",
  folderSaveFailed: "Échec de l’enregistrement du dossier",
  folderDeleteFailed: "Échec de la suppression du dossier",
  moveFailed: "Échec du déplacement",
  stopFailed: "Échec de l’arrêt",
  batchPartial: (ok: number, total: number) =>
    `${ok} sur ${total} conversations supprimées — les autres ont échoué`,
  // ---- management menus and dialogs -----------------------------------------
  hideThreads: "Masquer les conversations",
  actionsFor: (name: string) => `Actions pour ${name}`,
  actionsForFolder: (name: string) => `Actions pour le dossier ${name}`,
  rename: "Renommer",
  renameTitle: "Renommer la conversation",
  titleLabel: "Titre",
  moveToFolder: "Déplacer vers un dossier",
  abort: "Interrompre",
  delete: "Supprimer",
  deleteTitle: "Supprimer la conversation ?",
  deleteBody: (name: string) =>
    `Supprime « ${name} » et tous ses messages. Cette action est irréversible.`,
  deleteManyTitle: (count: number) => `Supprimer ${count} conversations ?`,
  deleteManyBody: (count: number) =>
    `Supprime ${count} conversations et tous leurs messages. Cette action est irréversible.`,
  deletingProgress: (done: number, total: number) =>
    `Suppression de ${done} sur ${total}…`,
  noFolder: "Aucun dossier",
  noFoldersYet: "Aucun dossier — créez-en un d’abord",
  newFolderTitle: "Nouveau dossier",
  renameFolderTitle: "Renommer le dossier",
  renameFolder: "Renommer le dossier",
  folderNameLabel: "Nom",
  folderHint:
    "Les dossiers regroupent les conversations par thème sur le tableau de bord. Supprimer un dossier conserve ses conversations.",
  create: "Créer",
  folderDeleteTitle: (name: string) => `Supprimer « ${name} » ?`,
  folderDeleteBody:
    "Le dossier est retiré et ses conversations reviennent dans le groupe « Conversations ». Aucune conversation n’est supprimée.",
  deleteFolder: "Supprimer le dossier",
  selectedCount: (count: number) =>
    `${count} sélectionnée${count > 1 ? "s" : ""}`,
  desktopOptions: "Options de l’environnement",
  desktopDrawer: "Environnement",
  startDesktopShort: "Démarrer",
  desktopDrawerHint:
    "Le modèle et le niveau de réflexion se règlent en bas de la conversation.",
  screenAsleep: "L’environnement est en veille",
  screenAsleepBody: "Démarrez l’environnement pour discuter avec OpenCode.",
  noThreadSelected: "Aucune conversation sélectionnée",
  noThreadSelectedBody: "Sélectionnez une conversation pour ouvrir son écran.",
  sleepStopping: "Mise en veille de l’environnement…",
  screenViewOnly: (name: string) =>
    `Écran de ${name}. Vue seule jusqu’à la prise de contrôle.`,
  takeControl: "Prendre le contrôle",
  reloadScreen: "Recharger l’écran",
  popOut: "Ouvrir dans une fenêtre",
  screenUnavailable: "Écran indisponible",
  screenOpening: "Ouverture de l’écran",
  screenOpeningBody: "Ouverture de l’écran de cette conversation…",
  screenNeedYou: "L’agent a besoin de vous",
  screenLiveView: "En direct · vue seule",
  screenYouDrive: "Vous conduisez — l’agent est en pause",
  screenYouDriveShort: "Vous conduisez",
  screenStepTake: "Prenez le contrôle",
  screenStepTaken: "Contrôle pris",
  screenStepAct: "Faites l’action",
  screenStepGive: "Rendez la main",
  screenStepActNow: "Étape 2 — à vous de jouer · l’agent est en pause",
  screenDoneYours: "C’est fait, à toi",
  screenDonePlain: "C’est fait",
  screenReleaseSilent: "Rendre sans message",
  screenRelease: "Rendre la main",
  screenLater: "Pas maintenant",
  screenResume: "Reprendre",
  screenHandedBack: "Écran rendu à l’agent",
  screenHandedBackBody: "il reprend la conversation.",
  screenShared: "Écran partagé par l’agent",
  screenSharedLater: "reporté — l’agent attend toujours.",
  screenSharedOlder: "remplacé par un partage plus récent.",
  screenOpenedAside: "Écran ouvert à côté",
  screenWaitingPill: "L’agent attend l’écran",
  screenOpeningNow: "L’écran arrive…",
  screenOpeningHint: "Connexion à l’écran de cette conversation",
  screenAsleepCard: "L’écran de cette conversation s’ouvrira dès le démarrage.",
  screenStartDesktop: "Démarrer l’environnement",
  screenErrorBody:
    "La connexion à l’écran a échoué. L’agent est toujours en pause sur cette tâche.",
  screenRetry: "Réessayer",
  screenOpenStage: "Ouvrir l’écran",
  screenCloseStage: "Fermer l’écran",
  screenFit: "Ajuster",
  screenFitWindow: "Ajuster à la fenêtre",
  screenFitNative: "Taille réelle (1:1)",
  screenDisplay: "Affichage",
  screenKeys: "Touches",
  screenKeysHint: "Échap prolongé = rendre la main",
  screenKeyEscape: "Échap",
  screenKeyCtrlAltDel: "Ctrl+Alt+Suppr",
  screenPasteText: "Coller du texte…",
  screenPaste: "Coller",
  screenKeyboard: "Clavier",
  screenKeyboardCaptured: "Clavier capturé — Échap prolongé pour sortir",
  screenApps: "Applications",
  screenFullscreen: "Plein écran",
  screenCancel: "Annuler",
  stopReply: "Arrêter",
  stopReplyAria: "Arrêter la réponse",
  queued: "En attente",
  queuedHint: "Envoyé dès que la réponse en cours se termine",
  forceSend: "Envoyer maintenant (interrompt la réponse en cours)",
  removeQueued: "Retirer de la file d’attente",
  joinedFiles: "Fichiers joints au message",
  previewJoined: (name: string) => `Aperçu plein écran de ${name}`,
  removeJoined: (name: string) => `Retirer ${name}`,
  queueFull: (count: number) =>
    `File d’attente pleine (${count} messages) — attendez la fin de la réponse.`,
  queuedSection: (count: number) =>
    count === 1 ? "1 message en attente" : `${count} messages en attente`,
  queuedShowAll: (count: number) => `Afficher les ${count} messages en attente`,
  queuedShowFewer: "Réduire",
  sendNow: "Envoyer maintenant",
  editQueued: "Modifier le message en attente",
  saveQueuedEdit: "Enregistrer",
  cancelEdit: "Annuler",
  copyMessage: "Copier le message",
  copiedMessage: "Copié",
  workedFor: (duration: string, steps: number) =>
    duration
      ? `A travaillé ${duration} · ${steps} ${steps === 1 ? "étape" : "étapes"}`
      : `A travaillé · ${steps} ${steps === 1 ? "étape" : "étapes"}`,
  workingSteps: (steps: number) =>
    `En cours · ${steps} ${steps === 1 ? "étape" : "étapes"}`,
} as const

/** Copy-to-clipboard button shown on code blocks in chat and council transcripts. */
export const CODE_COPY = {
  copy: "Copier le code",
  copied: "Copié",
} as const

/** Controls of the Applications view. */
export const APPS_UI = {
  filter: "Filtrer les applications",
  clearFilter: "Effacer le filtre d’applications",
  backToApps: "Retour aux applications",
  noMatch: (query: string) => `Aucune application pour « ${query} ».`,
  addApp: "Ajouter une application",
  manageExtensions: "Gérer les extensions",
  favorites: "Favoris",
  recents: "Récents",
  allApps: "Toutes les applications",
  addFavorite: (title: string) => `Ajouter « ${title} » aux favoris`,
  removeFavorite: (title: string) => `Retirer « ${title} » des favoris`,
  kindApp: "Application",
  kindPage: "Tableau de bord",
  kindIframe: "Lien externe",
} as const

/** The Config page's model + thinking journey (daily-essential settings). */
export const CONFIG_CHAT = {
  modelTitle: "Modèle de conversation par défaut",
  modelDescription:
    "Présélectionné pour les nouvelles conversations et enregistré comme modèle par défaut de votre environnement.",
  modelLocked:
    "Choisi par votre administrateur — le mode équipe de l’hôte applique ce modèle à tout le monde.",
  modelLockedHint:
    "Choisi par votre administrateur — le modèle de conversation partagé s’applique à tout le monde.",
  locked: "Verrouillé",
  notSet: "Non choisi",
  modelLabel: "Modèle par défaut",
  loadingModels: "Chargement des modèles",
  savedModel:
    "Enregistré. Les nouvelles conversations commenceront avec ce modèle.",
  noDefaultYet:
    "Aucun modèle par défaut choisi — les nouvelles conversations démarrent avec un sélecteur vide.",
  saveModel: "Enregistrer le modèle",
  saving: "Enregistrement…",
  unsaved: "non enregistré",
  reloadList: "Actualiser la liste",
  effortTitle: "Niveau de réflexion",
  effortDescription:
    "Le raisonnement que le modèle consacre à chaque réponse. Les options viennent des variantes prises en charge par le modèle par défaut.",
  effortModelDefault: "Par défaut du modèle",
  savedEffort:
    "Enregistré. Le prochain message de chaque conversation utilisera ce niveau.",
  effortPickModelFirst:
    "Choisissez d’abord un modèle par défaut — ses niveaux de réflexion apparaîtront ici.",
  effortNoVariants: "Ce modèle n’a pas de variantes de réflexion.",
  saveEffort: "Enregistrer",
  stepCapTitle: "Limite d’étapes par tour",
  stepCapDescription:
    "Nombre maximal d’étapes que l’assistant peut enchaîner dans un tour avant de devoir répondre. Laissez vide pour la valeur par défaut (512).",
  stepCapLabel: "Limite d’étapes",
  stepCapPlaceholder: "512 (par défaut)",
  stepCapHint:
    "L’enregistrement redémarre l’assistant (les tours en cours se terminent d’abord). Les sessions « sans limite » restent sans limite.",
  stepCapSaved:
    "Enregistré. La nouvelle limite s’applique aux prochains tours.",
  stepCapInvalid: "Entrez un nombre entier entre 1 et 100000, ou vide.",
  saveStepCap: "Enregistrer la limite",
} as const
