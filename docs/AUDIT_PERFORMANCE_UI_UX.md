# Rapport d'Audit Complet : Performance, UI & UX — NovaGuard

**Application** : NovaGuard (Surveillance locale, open source)
**Stack technique** : React Native 0.81, React 19, TypeScript, VisionCamera 4.x, TFLite (EfficientDet-Lite0/Lite2), Modules natifs Kotlin.
**Date d'audit** : Mars 2025

---

## Sommaire
1. [Synthèse Globale](#1-synthèse-globale)
2. [Audit de Performance & Architecture Technique](#2-audit-de-performance--architecture-technique)
   - 2.1 Chemin chaud (Frame Processor & Worklet ML)
   - 2.2 Rendu React & Churn
   - 2.3 Cycle de vie et exécution en arrière-plan
   - 2.4 I/O Disque, Enregistrement et Persistance
   - 2.5 Auto-Tune & Gestion thermique
3. [Audit UI & Expérience Utilisateur (UX)](#3-audit-ui--expérience-utilisateur-ux)
   - 3.1 Écran Surveillance & Viseur (`SurveillanceScreen`, `Viewfinder`)
   - 3.2 Écran Historique & Fiche Détail (`HistoryScreen`, `VideoDetailSheet`)
   - 3.3 Écran de Configuration (`SetupScreen`)
   - 3.4 Accessibilité, Ergonomie tactile & Thème
4. [Recommandations & Suggestions d'Amélioration](#4-recommandations--suggestions-damélioration)
   - 4.1 Quick Wins (Gain immédiat, faible risque)
   - 4.2 Améliorations UI & UX recommandées
   - 4.3 Optimisations Architecturales & Performance

---

## 1. Synthèse Globale

NovaGuard présente une architecture remarquablement robuste pour une application mobile de surveillance autonome. Les contraintes matérielles sévères d'un smartphone Android tournant 24h/24 (chauffe, dégradation de la batterie, pression mémoire, gestion CameraX) ont été anticipées avec un niveau de rigueur élevé :
- Traitement ML local synchrone évitant la rétention de tampons (`runAsync` écarté pour prévenir les fuites mémoires et les crashs CameraX).
- Isolation contextuelle (`AppStateContext` vs `ViewfinderCtx`) pour éviter le re-rendu de l'arbre entier à la fréquence de la caméra.
- Capture tamponnée en mémoire continue H.264/AAC ne muxant sur disque que les présences confirmées.
- Mode paysage dédié adapté à un smartphone posé sur un support.

Néanmoins, des axes de progrès notables subsistent en termes de **fluidité de l'interface**, de **retour d'information utilisateur**, de **clarté visuelle dans les réglages très denses**, et de **gestion des pics de calculs**.

---

## 2. Audit de Performance & Architecture Technique

### 2.1 Chemin chaud (Frame Processor & Worklet ML)
- **Constats** :
  - Dans `CameraFeed.tsx`, le frame processor analyse les images à une fréquence de 1 à 5 i/s (`targetFps`).
  - L'opération de letterboxing (`letterboxInto` dans `src/ml/letterbox.ts`) alloue un tableau Uint8Array par image analysée :
    `const buffer = new Uint8Array(size * size * channels);`
    Bien que requis pour éviter le partage de buffer entre runtimes worklet, cette allocation répétée génère une pression sur le garbage collector de Hermes / worklets.
  - Le pipeline de traçage de plantage (`onFrameStage('resize')`, `onFrameStage('inference')`, etc.) effectue plusieurs sauts de threads (`useRunOnJS`) inconditionnels par image. Même si le saut ne transfère qu'une chaîne primitive, il sollicite le pont React Native à chaque cycle de détection.
  - La détection de visages ML Kit (`detectFaces`) est judicieusement conditionnée (`autoZoom && people > 1`), ce qui évite un appel natif inutile lorsque le sujet est seul dans le champ.
- **Points d'attention** :
  - Lors de l'activation de `MODEL_PRECISE` (EfficientDet-Lite2 à 448x448), le temps d'inférence CPU/GPU est environ 3 fois supérieur à Lite0. Sur les appareils d'entrée ou de milieu de gamme, cela entraîne des baisses régulières de framerate dès que la température dépasse un seuil critique.
  - `interpretDetections.ts` effectue le décodage et le dédoublonnage de 4 tenseurs en JS/worklet. La boucle de suppression des doublons inter-classes (`overlapOf`) est en O(N^2), bien que N soit borné à 25 boîtes.

### 2.2 Rendu React & Churn
- **Constats** :
  - Excellente séparation architecturale : les détections et coordonnées par trame transitent par `ViewfinderCtx` / `useViewfinderState`, isolant le viseur du reste de l'application (`renderChurn.test.tsx` vérifie l'absence de re-rendus sur l'arbre principal).
  - Les réglages lus par le worklet ou par les callbacks passent par des références (`useLatest`), préservant la stabilité des identités de fonctions.
  - Dans `HistoryScreen.tsx`, l'utilisation de `useMemo` pour `allPassages`, `passages` et `rows` est bien en place.
- **Points d'attention** :
  - `SetupScreen.tsx` est un composant monolithique de plus de 1000 lignes. À chaque modification d'un interrupteur ou curseur (ex: sensibilité, seuil, horaire calme), l'ensemble des sections repliables et boutons de la vue se re-rendent simultanément.
  - `VideoDetailSheet.tsx` recalcule les passages et métadonnées sur chaque modification du tableau `events`. Lorsque l'historique comporte plusieurs centaines d'évènements, `groupPassages(events)` est exécuté à chaque mise à jour.

### 2.3 Cycle de vie et exécution en arrière-plan
- **Constats** :
  - `useForeground.ts` et `preview={foreground || active}` garantissent que le flux d'affichage est stoppé écran éteint sans désactiver la session CameraX, protégeant ainsi l'enregistrement de fond contre les blocages de session.
  - La notification de premier plan reflète l'état de surveillance de manière fiable avec redémarrage auto après incident caméra (`cameraHealth.ts`).

### 2.4 I/O Disque, Enregistrement et Persistance
- **Constats** :
  - La capture tamponnée (`useBufferedRecorder.ts`) résout le problème historique des clips coupés sans post-roll : les images antérieures à la confirmation sont rétroactivement conservées depuis la mémoire sans rupture d'encodage.
  - La suppression de fichiers (`deleteFiles` dans `videoStore.ts`) est plafonnée par `DELETE_CONCURRENCY = 8`, évitant de saturer le pool de threads I/O lors d'une suppression massive.
  - Le calcul du hash SHA-256 pour l'exportation des preuves (`hashRecording`) s'exécute en natif en arrière-plan, évitant de charger des fichiers vidéo volumineux en mémoire JavaScript.
- **Points d'attention** :
  - `AsyncStorage.setItem` est déclenché par un effet React à chaque ajout d'évènement ou changement de réglage. En cas de rafale de détections, des écritures JSON volumineuses peuvent se succéder sur le stockage flash.

### 2.5 Auto-Tune & Gestion thermique
- **Constats** :
  - `autoTune.ts` suit une politique asymétrique éprouvée (3 fenêtres de 2 secondes pour dégrader, 15 fenêtres pour restaurer).
  - L'intégration de `deviceLoad.ts` (`load.thermal === 'hot'`) permet de réagir immédiatement (1 fenêtre) lors d'un emballement thermique, avant que le système Android ne tue le processus.

---

## 3. Audit UI & Expérience Utilisateur (UX)

### 3.1 Écran Surveillance & Viseur (`SurveillanceScreen`, `Viewfinder`)
- **Forces** :
  - CTA principal clair et explicite : bouton plein et vibrant à l'état inactif, bordure statut discrète quand actif.
  - Les compteurs (« Dernière », « Aujourd'hui », « Espace ») sont cliquables et mènent directement à la ressource associée.
  - En mode paysage, la mise en page passe intelligemment en deux colonnes : le viseur occupe toute la hauteur à gauche, et les contrôles se placent à portée du pouce à droite.
- **Axes d'amélioration** :
  - **Retour visuel lors de l'enregistrement actif** : Quand la caméra détecte et enregistre une présence, le badge de statut passe en rouge, mais le viseur ne donne pas de repère visuel périphérique franc (par exemple, un liseré clignotant subtil autour de l'image).
  - **Zone d'exclusion / Détection** : Lors de l'édition d'une zone (`ZoneLayer.tsx`), les poignées de redimensionnement peuvent être difficiles à attraper sur un petit écran tactile si les doigts masquent le rectangle.

### 3.2 Écran Historique & Fiche Détail (`HistoryScreen`, `VideoDetailSheet`)
- **Forces** :
  - Regroupement des clips en « passages » : une intrusion de 2 minutes coupée en clips de 60 secondes reste un seul évènement logique pour l'utilisateur.
  - Écran vide contextualisé (`EmptyHistory`) guidant l'utilisateur selon que la rétention a purgé les vidéos ou que la caméra n'a encore jamais tourné.
  - Sélection multiple fluide avec suppression groupée (`pickBar`).
- **Axes d'amélioration** :
  - **Indicateur de chargement de l'export de preuves** : L'opération d'export (`exportPassage`) calcule les empreintes SHA-256 de multiples fichiers 4K. Le libellé du bouton passe à `detail.export.busy`, mais une barre de progression ou un retour d'avancement par clip rassurerait l'utilisateur pendant les passages longs.
  - **Contrôles de lecture vidéo** : Le composant vidéo repose sur les contrôles natifs intégrés. L'affichage d'un bouton de saut rapide (+/- 5 secondes) et d'un indicateur de vitesse de lecture (1x / 1.5x / 2x) améliorerait grandement le visionnage de passages suspects.

### 3.3 Écran de Configuration (`SetupScreen`)
- **Forces** :
  - Sections repliables mémorisées (`exp.surv`, `exp.det`, etc.).
  - Informations de confidentialité omniprésentes et rassurantes (aucun compte, traitement local).
  - Gestion claire des paramètres MCP avec code QR et copie en un tap.
- **Axes d'amélioration** :
  - **Densité cognitive excessive** : L'écran propose plus d'une trentaine de réglages techniques (cadence, seuils, ports, jetons, TLS, exclusion, auto-tune). Certains réglages très spécialisés mériteraient d'être regroupés dans un sous-menu ou masqués par défaut sous un mode « Expert ».
  - **Feedbacks de copie** : Le statut copié s'affiche temporairement à la place du libellé du bouton pendant 2 secondes. L'ajout d'une notification toast légère ou d'une icône de validation apporterait un confort visuel accru.

### 3.4 Accessibilité, Ergonomie tactile & Thème
- **Forces** :
  - Thème sombre soigné avec contrastes vérifiés et testés unitairement (`contrast.test.ts`).
  - Tolérance aux polices agrandies encadrée par `MAX_FONT_SCALE = 1.4` sur les zones denses pour éviter le masquage de texte.
  - `TOUCH_SLOP` appliqué sur les petits contrôles pour respecter les recommandations Android (48 dp minimum effectif).
  - Retour haptique lors du basculement de la surveillance.
- **Axes d'amélioration** :
  - Certains curseurs tactiles (`Slider` pour les horaires calmes ou seuils) restent délicats à manipuler d'un seul doigt sur des téléphones étroits.

---

## 4. Recommandations & Suggestions d'Amélioration

### 4.1 Quick Wins (Faible coût, gain immédiat)
1. **Mise en cache du regroupement de passages** : Dans `HistoryScreen.tsx` et `VideoDetailSheet.tsx`, mémoïser `groupPassages` avec une clé d'invalidation basée sur la longueur et le timestamp du dernier évènement pour éviter de re-scanner tout le tableau d'évènements à chaque interaction.
2. **Indicateur de progression d'exportation** : Dans `VideoDetailSheet.tsx`, afficher l'avancement du hachage (ex. « Hachage du clip 1/3... ») au lieu d'un texte figé.
3. **Subdivision de `SetupScreen.tsx`** : Extraire les sections en sous-composants mémoïsés (`SetupSectionSurveillance`, `SetupSectionDetection`, `SetupSectionStorage`, `SetupSectionMcp`) pour diviser le temps de réconciliation React par 3 lors du basculement d'une option.

### 4.2 Améliorations UI & UX
1. **Liseré de présence active sur le viseur** : Ajouter une pulsation lumineuse discrète (liseré de 1.5px rouge/vert pastel) sur le contour de `Viewfinder` dès qu'un sujet confirmé est filmé, confirmant visuellement la prise d'action.
2. **Revue du mode d'affichage des réglages MCP** : Présenter la configuration MCP sous forme d'onglets ou de cartes déroulantes (« Assistant local », « Direct Wi-Fi », « Accès distant ») plutôt qu'une longue succession de commutateurs.
3. **Touches de saut rapide dans le lecteur** : Ajouter des gestes de double-tap à gauche/droite de l'aperçu vidéo pour reculer/avancer de 5 secondes.

### 4.3 Optimisations Architecturales & Performance
1. **Debounce sur la sérialisation des évènements** : Mettre en place un debounce de 500 ms sur `storage.saveEvents` afin de regrouper les écritures lors de détections rapprochées.
2. **Pré-allocation des buffers de letterbox** : Dans `src/ml/letterbox.ts`, évaluer la possibilité d'utiliser un buffer statique par taille d'entrée (320 et 448) réutilisable entre chaque image dans le même contexte worklet pour alléger le ramasse-miettes.
3. **Réduction de la fréquence des étapes de trace** : Réserver les notifications `onFrameStage` aux démarrages et aux transitions critiques, ou désactiver les sauts de thread JS une fois la première frame analysée avec succès (`frameStage` validé).
