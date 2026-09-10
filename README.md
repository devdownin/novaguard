# NovaGuard

Caméra de surveillance intelligente, locale et open source. NovaGuard transforme un smartphone Android en caméra de détection de personnes et d'animaux — toute la détection et l'enregistrement restent sur l'appareil, rien n'est envoyé vers un serveur.

[![CI](https://github.com/devdownin/novaguard/actions/workflows/ci.yml/badge.svg)](https://github.com/devdownin/novaguard/actions/workflows/ci.yml)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)

## Fonctionnalités

- **Surveillance** — flux caméra en direct, indicateur d'état, démarrage/arrêt en un geste, dernières statistiques (dernière détection, détections du jour, espace disponible).
- **Détection sur l'appareil** — personnes et animaux, reconnus en local par EfficientDet-Lite0 (TensorFlow Lite, COCO) sur **tout** le champ de vision et sur une image redressée. Suivi multi-sujets : chaque personne présente est encadrée, avec son niveau de confiance. Un sujet doit être vu sur plusieurs images consécutives avant de déclencher un événement, et survit à une occlusion brève sans couper l'événement en deux.
- **Zoom auto sur les personnes** — quand quelqu'un est détecté, le cadrage glisse doucement sur cette personne **entière**, de la tête aux pieds, s'y maintient 4 s, puis revient en plan large sur toute la scène et s'y pose avant qu'un nouveau plan serré soit permis. Un visage détecté (ML Kit) ne sert qu'à choisir qui regarder quand plusieurs personnes sont dans le champ : quelqu'un de dos ou dans le noir est suivi de la même façon. Mouvement animé sur le driver natif, donc insensible à la charge de l'inférence. Désactivable dans Setup → Détection.
- **Enregistrement** — chaque détection confirmée écrit un clip MP4 (H.264) nommé d'après ce qui l'a déclenché — `Personne_2026-09-02_14-32-07.mp4` — dans le stockage privé de l'application. Un enregistrement ne démarre jamais sans sujet confirmé, et un clip qu'aucun évènement ne réclame est supprimé plutôt que laissé sur disque : aucune permission de stockage, rien dans la galerie partagée, tout disparaît à la désinstallation. La qualité (720p/1080p/4K), la durée après détection et la durée maximale d'un clip sont réglables ; au-delà du maximum le clip est coupé et la suite enregistrée dans un segment suivant.
- **Partager un clip** — les enregistrements restent dans le répertoire privé de l'application, qu'aucune autre app ne peut lire ; le bouton « Partager » du détail d'un évènement ouvre le sélecteur Android et offre **ce fichier-là**, par une URI temporaire. Rien ne sort sans ce geste.
- **Surveillance en arrière-plan** — un service de premier plan de type `camera` (plus `microphone` quand la permission est accordée) démarre avec la surveillance : Android autorise alors la caméra hors écran et ne ferme pas le processus. Une notification permanente et silencieuse indique que la caméra est active ; elle est masquée sur l'écran verrouillé.
- **Gestion du stockage** — rétention configurable (1 à 90 jours, ou toujours), suppression automatique des clips les plus anciens quand le volume passe sous 500 Mo libres, espace réellement mesuré sur l'appareil, et nettoyage au démarrage des fichiers qu'aucun évènement ne référence plus.
- **Alertes** — notification à l'ouverture d'une détection, avec un délai minimum d'une minute entre deux. Elle réveille sur l'écran verrouillé sans y afficher ce qui a été vu. Le son et la vibration se règlent dans les paramètres Android du canal, où Android les a placés depuis la version 8.
- **Historique** — événements enregistrés sous forme de cartes, filtrables par type et par période, avec détail complet (lecture de la vidéo, confiance, taille réelle, suppression) en panneau.
- **Setup** — réglages de surveillance, détection, enregistrement, stockage et notifications regroupés par sections repliables ; la sensibilité et le seuil de confiance pilotent directement le pipeline de détection.
- **Confidentialité par conception** — traitement 100 % local, détection et enregistrement compris. Les clips restent dans le stockage privé de l'application, les réglages et l'historique dans `AsyncStorage`, et l'APK de release ne déclare même pas la permission `INTERNET`.
- **Premier lancement** — écran de démarrage animé (viseur, marque, trois piliers du produit) pendant l'hydratation de l'état persisté, avant l'onboarding.

> Plus aucun réglage de l'interface n'est décoratif : tout ce qui est affiché agit réellement, ou a été retiré. Rien n'a toutefois pu être exécuté sur un vrai capteur dans cet environnement de build (ni SDK Android ni émulateur) : la géométrie, la gestion du stockage et les règles d'alerte sont couvertes par des tests unitaires, mais la capture, l'orientation, l'alignement des cadres et tout le code natif restent à valider en conditions réelles — voir [Feuille de route](#feuille-de-route). Le workflow CI produit un APK installable pour ça.

## Stack technique

- [React Native](https://reactnative.dev) (CLI *bare*, sans Expo) — Android 16 (API 36) minimum ; `minSdk`, `compileSdk` et `targetSdk` sont tous à 36, donc un seul niveau de plateforme à supporter
- TypeScript
- [react-native-vision-camera](https://github.com/mrousavy/react-native-vision-camera) pour le flux caméra et les frame processors
- [react-native-fast-tflite](https://github.com/mrousavy/react-native-fast-tflite) pour l'inférence TensorFlow Lite embarquée (`assets/models/efficientdet-lite0.tflite`, quantifié uint8 320×320, et `efficientdet-lite2.tflite` en 448 px derrière le réglage « Détection étendue » — même labelmap COCO, licence Apache-2.0), avec délégué GPU et repli CPU automatique
- [react-native-vision-camera-face-detector](https://github.com/luicfrr/react-native-vision-camera-face-detector) (ML Kit) pour la détection de visages, qui désigne le sujet du zoom auto
- [vision-camera-resize-plugin](https://github.com/mrousavy/vision-camera-resize-plugin) et [react-native-worklets-core](https://github.com/margelo/react-native-worklets-core) pour le traitement des frames sur un thread dédié
- [react-native-svg](https://github.com/software-mansion/react-native-svg), [react-native-linear-gradient](https://github.com/react-native-linear-gradient/react-native-linear-gradient), [@react-native-community/slider](https://github.com/callstack/react-native-slider)
- [@dr.pogodin/react-native-fs](https://github.com/birdofpreyru/react-native-fs) pour les fichiers vidéo et l'espace disque, [react-native-video](https://github.com/TheWidlarzGroup/react-native-video) pour la lecture
- [@react-native-async-storage/async-storage](https://github.com/react-native-async-storage/async-storage) pour la persistance locale
- Police [Inter](https://rsms.me/inter/) (SIL OFL 1.1)

## Démarrage

Prérequis : suivre le guide [Set Up Your Environment](https://reactnative.dev/docs/set-up-your-environment) de React Native pour Android (JDK, Android Studio/SDK, un émulateur ou un appareil connecté).

```sh
git clone https://github.com/devdownin/novaguard.git
cd NovaGuard
npm install
npm run android
```

`npm start` lance Metro séparément si besoin. Voir aussi [`CONTRIBUTING.md`](CONTRIBUTING.md) pour le détail des scripts (`lint`, `test`, `tsc`).

### Récupérer un APK sans installer l'environnement Android

Le workflow [`CI`](.github/workflows/ci.yml) construit un APK installable après chaque fusion sur `main`, lors de la publication d'un tag de version (ex. `v1.0.0`, automatiquement joint à la *Release* GitHub), et à la demande sur n'importe quelle branche : onglet **Actions** → *CI* → **Run workflow** (choisir la branche), puis récupérer `novaguard-release-apk` dans les artefacts du run une fois terminé. Aucun secret de signature n'est nécessaire pour cet APK : il est signé avec le keystore de debug du dépôt, ce qui suffit à l'installer sur un appareil de test. Ce qui part sur le Play Store est un autre artefact — un *App Bundle* signé par une clé d'upload qui ne vit pas dans le dépôt — voir [Publication](#publication-sur-google-play).

## Publication sur Google Play

Le dépôt sait produire l'artefact que Play accepte :

```bash
docker build -t novaguard-android .
BUILD_SCRIPT=scripts/build-aab.sh SIGNING_DIR=/chemin/du/keystore \
  scripts/build-apk-in-docker.sh novaguard-android
```

- `versionName` vient de `package.json` — un seul endroit à incrémenter ;
  `versionCode` est le compteur d'upload de Play, passé par la CI
  (`-PnovaguardVersionCode=`).
- Les identifiants de la clé d'upload viennent de `android/keystore.properties`
  (git-ignoré), de `~/.gradle/gradle.properties` ou de l'environnement. Sans eux,
  l'APK se construit toujours et **le bundle refuse de se construire** plutôt que
  d'être signé par le keystore de debug, que Play rejette.
- Pousser un tag `vX.Y.Z` déclenche le job `build-aab`, qui produit l'artefact
  `novaguard-play-bundle`. Il n'est pas joint à la Release GitHub : un bundle
  signé n'a rien à faire sur une page de téléchargement publique.

La marche à suivre complète — création de la clé, secrets GitHub, formulaire
*Data safety*, justification des services de premier plan, brouillon de fiche
Store, visuels manquants — est dans [`docs/PLAY_STORE.md`](docs/PLAY_STORE.md).
La politique de confidentialité, dont Play exige une URL publique, est dans
[`PRIVACY.md`](PRIVACY.md).

> **À trancher avant de créer la fiche :** `minSdk` est à 36 (Android 16). C'est
> un choix assumé — un seul niveau de plateforme, donc aucune branche de
> compatibilité dans le code — mais sur le Store il rend l'application
> incompatible avec l'immense majorité des téléphones en circulation. Les trois
> options sont détaillées en tête de `docs/PLAY_STORE.md`.

## Structure du projet

```
src/
  components/   composants d'interface réutilisables (boutons, switch, feuilles, icônes…)
  screens/      les trois écrans principaux : Surveillance, Historique, Setup
  state/        état applicatif (contexte React), types, valeurs par défaut, persistance
  camera/       sélection du device caméra, géométrie de cadrage et machine à états du zoom auto
  recording/    capture des clips, rétention, récupération d'espace et accès disque
  surveillance/ service de premier plan, permission de notification, règles d'alerte
  specs/        specs TurboModule (codegen) des modules natifs de l'application
  ml/           décodage des sorties du modèle TFLite, labels COCO, suivi des sujets (IoU)
  constants/    métadonnées de l'application (version, licence, dépôt)
  utils/        fonctions utilitaires (dates)
  theme.ts      jetons de design (couleurs, typographie, espacements)
assets/fonts/   police Inter embarquée
assets/models/  modèle de détection TensorFlow Lite embarqué
assets/splash/  illustration de l'écran de démarrage
assets/store/   icône source et icône 512×512 pour les fiches store
```

## Feuille de route

- [x] Flux caméra réel (`react-native-vision-camera`)
- [x] Détection de personnes/animaux sur l'appareil (TensorFlow Lite)
- [x] Enregistrement vidéo réel et gestion du stockage
- [ ] Vérifier sur un vrai appareil le sens de redressement des images (`src/camera/orientation.ts`), l'alignement des cadres et toute la chaîne d'enregistrement — la géométrie et la gestion du stockage sont couvertes par des tests unitaires, mais ni la convention d'orientation du capteur ni la capture elle-même ne le sont
- [x] Service de premier plan, pour que la caméra reste autorisée hors écran
- [ ] Confirmer sur appareil que la capture survit à l'écran éteint (le service rend l'accès caméra autorisé ; le sort de la surface d'aperçu reste à vérifier)
- [ ] Partage d'un enregistrement (nécessite un `FileProvider` Android)
- [x] Notifications à chaque détection

## Contribuer

Les contributions sont bienvenues — voir [`CONTRIBUTING.md`](CONTRIBUTING.md) et le [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

## Licence

NovaGuard est distribué sous licence [GNU GPL v3.0](LICENSE).
