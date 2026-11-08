# Plan d'Action Opérationnel : Performance, UI & UX — NovaGuard

Ce document fait suite à l'audit exhaustif (`docs/AUDIT_PERFORMANCE_UI_UX.md`). Il planifie et détaille les actions d'amélioration par ordre de priorité, avec pour chaque tâche le périmètre, l'effort estimé, l'impact attendu, les risques et les critères d'acceptation.

---

## Vue d'ensemble du planning

| Phase | Objectif principal | Effort estimé | Impact clé |
|---|---|---|---|
| **Phase 1 : Quick Wins & Fluidité** | Éliminer les re-calculs inutiles et clarifier les retours d'actions | 2 - 3 jours | -60 % de temps de calcul sur l'Historique / Réglages, meilleure réactivité |
| **Phase 2 : Ergonomie & Confort UX** | Moderniser le retour visuel de capture, la navigation et le lecteur | 3 - 5 jours | Meilleure compréhension du statut caméra, confort de visionnage |
| **Phase 3 : Optimisations Système & ML** | Réduire l'empreinte mémoire et le travail en arrière-plan | 4 - 6 jours | Réduction du garbage collection, autonomie accrue, stabilité thermique |

---

## Phase 1 : Quick Wins & Fluidité (Priorité Haute)

### 1.1 Mémoïsation et cache du regroupement des passages (`groupPassages`)
- **Problématique** : Dans `HistoryScreen.tsx` et `VideoDetailSheet.tsx`, la fonction `groupPassages(events)` re-parcourt la totalité du tableau d'évènements à chaque re-rendu ou changement mineur d'état.
- **Action** :
  - Mettre en place un cache de dérivation mémoïsé basé sur la longueur du tableau et l'identifiant du dernier évènement (`lastEventId`).
  - Éviter de recalculer `groupPassages` dans la fiche détail quand seul le statut de lecture ou la sélection change.
- **Fichiers impactés** : `src/screens/HistoryScreen.tsx`, `src/components/VideoDetailSheet.tsx`, `src/recording/passages.ts`.
- **Gain** : Zéro coût de calcul sur de longs historiques (500+ clips) lors de la simple ouverture d'une fiche.
- **Risque** : Très faible (logique pure et testée).

### 1.2 Progression dynamique du hachage de preuves (Export)
- **Problématique** : L'exportation de passages vidéo longs calcule séquentiellement les empreintes SHA-256 de multiples fichiers 4K. L'interface affiche uniquement « Préparation de l’export… » de façon statique, sans visibilité sur l'avancement.
- **Action** :
  - Ajouter un état `exportProgress: { current: number; total: number }` dans `VideoDetailSheet.tsx`.
  - Mettre à jour le texte du bouton ou afficher un sous-titre dynamique : `« Hachage du clip 2/5… »`.
- **Fichiers impactés** : `src/components/VideoDetailSheet.tsx`, `src/i18n/fr.ts`, `src/i18n/en.ts`.
- **Gain** : Élimine l'impression de gel de l'application pendant les exports volumineux.
- **Risque** : Aucun.

### 1.3 Découpage modulaire de l'écran des Réglages (`SetupScreen.tsx`)
- **Problématique** : `SetupScreen.tsx` dépasse 1000 lignes dans un seul composant. Modifier n'importe quel commutateur (ex: surveillance de nuit) déclenche la réconciliation React de l'ensemble des sections repliables.
- **Action** :
  - Découper les sections en sous-composants mémoïsés (`React.memo`) :
    - `SetupSectionSurveillance`
    - `SetupSectionDetection`
    - `SetupSectionRecording`
    - `SetupSectionStorage`
    - `SetupSectionNotifications`
    - `SetupSectionAdvanced`
    - `SetupSectionMcp`
- **Fichiers impactés** : `src/screens/SetupScreen.tsx` et nouveau sous-dossier `src/screens/setup/`.
- **Gain** : Gain de fluidité immédiat sur les appareils modestes ; code maintenable et testable isolément.
- **Risque** : Faible (conservation des props et callbacks existants).

---

## Phase 2 : Ergonomie & Confort UX (Priorité Moyenne)

### 2.1 Liseré de présence active sur le viseur
- **Problématique** : Quand un sujet pénètre dans le champ et déclenche un enregistrement, le badge de statut supérieur change, mais le viseur lui-même manque d'un repère visuel périphérique direct visible de loin.
- **Action** :
  - Ajouter une bordure intérieure animée (pulsation pastel de 2 dp, rouge pour enregistrement / vert pour veille active) autour du cadre de `Viewfinder.tsx`.
  - Conditionner l'animation à `!useReducedMotion()` pour respecter l'accessibilité.
- **Fichiers impactés** : `src/components/Viewfinder.tsx`, `src/theme.ts`.
- **Gain** : Confirmation instantanée pour l'utilisateur qui teste le cadrage de sa caméra en passant devant à plusieurs mètres.
- **Risque** : Très faible (simple couche visuelle de contour).

### 2.2 Gestes de saut rapide (+/- 5 s) et vitesse dans le lecteur vidéo
- **Problématique** : L'examen de séquences de détection suspectes de plusieurs minutes est fastidieux avec la seule barre de défilement standard.
- **Action** :
  - Intégrer deux zones tactiles invisibles (gauche et droite) sur la vidéo pour reculer ou avancer de 5 secondes au double-tap.
  - Ajouter un sélecteur discret de vitesse de lecture (1x, 1.5x, 2x).
- **Fichiers impactés** : `src/components/VideoDetailSheet.tsx`.
- **Gain** : Inspection rapide et efficace des passages filmés.
- **Risque** : Faible (dépend des capacités de `react-native-video`).

### 2.3 Refonte visuelle des réglages MCP et assistants
- **Problématique** : La section MCP aligne un grand nombre d'options techniques (URL, jetons, TLS, cloud, PIN de flux, empreinte CA, port) qui saturent l'utilisateur non averti.
- **Action** :
  - Réorganiser la section en 3 cartes ou onglets distincts :
    1. *Assistant Local* (Agent sur le même appareil ou réseau local).
    2. *Accès Cloud / Relais* (Connexion distante sécurisée).
    3. *Options Réseau Avancées* (Ports, TLS, empreintes).
- **Fichiers impactés** : `src/screens/SetupScreen.tsx`, `src/components/McpConnectSheet.tsx`.
- **Gain** : Réduction de la charge mentale, configuration guidée sans friction.
- **Risque** : Nécessite une validation UX des parcours utilisateurs.

---

## Phase 3 : Optimisations Système & ML (Priorité Structurelle)

### 3.1 Debounce sur la persistance AsyncStorage (`saveEvents`)
- **Problématique** : Chaque évènement ou mise à jour de méta-données provoque une sérialisation immédiate dans AsyncStorage. En cas d'évènements rapprochés, le thread JS effectue des écritures JSON lourdes successives.
- **Action** :
  - Appliquer un debounce de 400 ms sur la persistance du tableau d'évènements, tout en forçant l'écriture synchrone à la fermeture de session ou à la mise en arrière-plan.
- **Fichiers impactés** : `src/state/AppStateContext.tsx`, `src/state/storage.ts`.
- **Gain** : Diminution de l'usure de la mémoire flash et soulagement du thread JS lors des passages continus.
- **Risque** : Moyen (veiller à ce qu'aucun crash n'entraîne la perte d'un clip non persisté).

### 3.2 Optimisation du recyclage de buffers de letterbox
- **Problématique** : `letterboxInto` réalloue un `Uint8Array` à chaque trame analysée (jusqu'à 5 fois par seconde).
- **Action** :
  - Évaluer un mécanisme de buffer partagé réutilisable par taille d'entrée fixe (320x320 et 448x448) au sein du runtime worklet, sans traverser le pont JS.
- **Fichiers impactés** : `src/ml/letterbox.ts`, `src/components/CameraFeed.tsx`.
- **Gain** : Réduction drastique des cycles de Garbage Collection Hermes sur les sessions de plusieurs heures.
- **Risque** : Élevé (doit impérativement respecter la règle worklet de copie/closure sous peine de crash natif SIGSEGV). À tester sur matériel réel.

### 3.3 Allègement des sauts de thread JS de diagnostic (`onFrameStage`)
- **Problématique** : `CameraFeed.tsx` appelle `onFrameStage` 3 à 4 fois par trame analysée via `useRunOnJS` pour documenter l'étape en cours en cas de crash natif.
- **Action** :
  - Dès qu'une trame est entièrement traitée avec succès (`frameStage` complété et validé une fois), basculer les traces de diagnostic en mode passif ou réduire leur émission continue.
- **Fichiers impactés** : `src/components/CameraFeed.tsx`, `src/camera/frameTrace.ts`.
- **Gain** : Économie de plusieurs dizaines d'appels inter-runtimes par seconde.
- **Risque** : Moyen (s'assurer de ne pas dégrader le diagnostic de crash post-mortem documenté dans `CLAUDE.md`).

---

## Critères de Réussite & Métriques de Validation

1. **Fluidité & Réactivité** :
   - Zéro lag perceptible lors du basculement d'interrupteurs dans les Réglages.
   - Moins de 16 ms de délai de rendu lors de la sélection d'un passage dans l'Historique.
2. **Stabilité Thermique** :
   - Absence de dépassement du seuil thermique critique (`load.thermal === 'hot'`) sur des sessions de surveillance continue d'au moins 2 heures en résolution standard (1080p).
3. **Qualité de Code & Non-Régression** :
   - 100 % des tests unitaires et d'intégration validés (`npm test`).
   - 0 erreur TypeScript (`npm run typecheck`) et 0 avertissement linter (`npm run lint`).
   - Conformité totale avec les directives d'accessibilité (`accessibility.test.tsx`, `contrast.test.ts`).
