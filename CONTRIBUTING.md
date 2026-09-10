# Contribuer à NovaGuard

Merci de votre intérêt pour NovaGuard ! Ce projet est open source (GPL-3.0) et les contributions — code, documentation, rapports de bugs, traductions — sont les bienvenues.

## Avant de commencer

- Merci de respecter notre [Code de conduite](CODE_OF_CONDUCT.md).
- Pour un changement important (nouvelle fonctionnalité, refonte), ouvrez d'abord une [issue](../../issues) pour en discuter avant d'investir du temps dans une pull request.
- Pour un bug ou une petite correction, une pull request directe est bienvenue.

## Mettre en place l'environnement

```sh
git clone <votre-fork>
cd NovaGuard
npm install
```

Suivez ensuite le guide [Set Up Your Environment](https://reactnative.dev/docs/set-up-your-environment) de React Native (onglet Android) si ce n'est pas déjà fait.

## Développer

```sh
npm start          # démarre Metro
npm run android     # build + lance l'app sur émulateur/appareil Android
```

Avant de proposer une pull request, vérifiez que le projet est propre :

```sh
npm run typecheck   # types (tsc --noEmit)
npm run lint        # ESLint
npm test            # Jest (unitaires)
npm run test:e2e    # Maestro (tests UI E2E sur émulateur/appareil)
```

Ces trois vérifications tournent aussi automatiquement en CI (GitHub Actions) sur chaque pull request — voir [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## Dépendances : ce qui est volontairement figé

Plusieurs dépendances ne sont **pas** à leur dernière version majeure, et c'est délibéré. Merci de ne pas les bumper sans traiter le point correspondant — `npm outdated` les signalera, ce n'est pas un oubli.

| Dépendance | Version | Dernière | Pourquoi on reste |
| --- | --- | --- | --- |
| `react-native-vision-camera` | 4.7.x | 5.x | La v5 est une réécriture sur [Nitro Modules](https://nitro.margelo.com) : `useFrameProcessor` et `useCameraFormat` n'existent plus, les frame processors passent par `react-native-vision-camera-worklets` au lieu de `react-native-worklets-core`. `src/components/CameraFeed.tsx` est à réécrire entièrement. |
| `vision-camera-resize-plugin` | 3.2.0 | 3.2.0 (à jour) | **C'est le vrai verrou.** Dernière publication en décembre 2024, `peerDependencies` toujours sur `react-native-vision-camera >=4.0.1` + `react-native-worklets-core`. Aucune version compatible Nitro. Tant qu'il n'en existe pas, passer VisionCamera en v5 casse le redimensionnement des frames — donc l'inférence. |
| `react-native-fast-tflite` | 1.6.x | 3.x | La v3 exige `react-native-nitro-modules` ; à migrer en même temps que VisionCamera, pas avant. |
| `react-native-vision-camera-face-detector` | 1.10.x | 2.x | La v2 exige `react-native-vision-camera >= 5.0`. Même blocage. |
| `eslint` | 8.x | 10.x | `@react-native/eslint-config` ne déclare `eslint` qu'en `^8 || ^9`, y compris dans sa version 0.87.1. La v10 n'est supportée par aucune version de React Native. |
| `typescript` | 5.9.x | 7.x | Vérifié : `tsc --noEmit` et les tests passent en TS 7, mais `npm run lint` **échoue**. Le paquet `typescript` 7 n'expose plus l'API historique du compilateur (`createProgram`, `ScriptKind`, `TypeFlags` sont `undefined`), et `@typescript-eslint` 7 — tiré par `@react-native/eslint-config` — plante au chargement (`Cannot read properties of undefined (reading 'Intrinsic')`). |
| `@babel/*` | 7.x | 8.x | `@babel/plugin-proposal-optional-chaining` et `@babel/plugin-proposal-nullish-coalescing-operator` ont été supprimés dans Babel 8 (figés en 7.21.0 / 7.18.6). `react-native-worklets-core` les réclame encore par ces noms dépréciés lors de sa retransformation interne : sans eux, le bundle Metro de production ne se construit pas. |
| `react` | 19.1.0 | 19.2.x | Version alignée sur celle avec laquelle React Native 0.81 est validé. À bumper avec React Native, pas séparément. |
| `react-native` | 0.81.4 | 0.87.1 | Mise à niveau réelle (fichiers natifs `android/`, Gradle, template) impossible à valider sans build Android. Exige aussi Node `^22.13 || ^24.3 || >=26` et React `^19.2.3`. |

En clair : **tout le bloc caméra + ML se met à jour d'un seul tenant ou pas du tout**, et il attend une version Nitro de `vision-camera-resize-plugin` (ou son remplacement par une autre méthode de redimensionnement, par exemple `react-native-nitro-image`).

## Style de code

- TypeScript strict, pas de `any` sauf nécessité justifiée.
- Les couleurs, espacements et typographies viennent de `src/theme.ts` — éviter les valeurs codées en dur.
- Un composant réutilisable va dans `src/components/`, un écran dans `src/screens/`, l'état partagé dans `src/state/`.
- Suivre le style déjà en place (voir `.eslintrc.js` / `.prettierrc.js`) plutôt que d'introduire de nouvelles conventions.

## Soumettre une pull request

1. Forkez le dépôt et créez une branche depuis `main` (`git checkout -b ma-fonctionnalite`).
2. Faites vos changements, avec des commits clairs.
3. Vérifiez `tsc`, `lint` et `test` (voir ci-dessus).
4. Ouvrez la pull request en décrivant le changement et son motif ; reliez l'issue concernée le cas échéant.

## Signaler un bug ou proposer une fonctionnalité

Utilisez les [templates d'issue](.github/ISSUE_TEMPLATE) du dépôt — ils indiquent les informations utiles à fournir.

## Licence

En contribuant, vous acceptez que vos contributions soient distribuées sous la licence [GPL-3.0](LICENSE) du projet.
