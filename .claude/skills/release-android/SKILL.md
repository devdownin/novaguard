---
name: release-android
description: Construire l'APK NovaGuard et publier sur le Play Store — image Docker de la chaîne d'outils, scripts build-apk/build-aab, signature, versionCode, et les workflows CI qui les appellent. À utiliser pour tout ce qui touche à un artefact livrable (APK, App Bundle, image de build, release GitHub).
---

# Livrer NovaGuard

## Construire l'APK

Le SDK Android n'est pas nécessaire sur la machine : `Dockerfile` porte la
chaîne d'outils, épinglée sur exactement ce que `android/build.gradle` demande
(plateforme 36, build-tools 36.0.0, NDK 27.1.12297006, CMake 3.30.5, JDK 17,
Node 22). L'image ne contient que les outils ; les sources sont montées.

```bash
docker build -t novaguard-android .
scripts/build-apk-in-docker.sh novaguard-android
```

L'APK sort dans `android/app/build/outputs/apk/release/`.

Deux scripts, et la raison de la séparation compte :

- `scripts/build-apk.sh` — ce qui transforme le dépôt en APK (`npm ci`, puis
  `assembleRelease`). Tourne *dans* l'image.
- `scripts/build-apk-in-docker.sh` — l'invocation `docker run` : montage des
  sources, caches Gradle et npm, et `--user` pour que Gradle ne laisse pas des
  répertoires appartenant à root dans votre checkout.

La CI appelle exactement ces deux-là. Un chemin de release que personne
n'exécute est précisément la façon dont le build d'APK est resté cassé pendant
onze fusions sans que personne ne le voie : ici, ce que la PR vérifie et ce que
la release exécute sont la même commande.

L'image est publiée sur `ghcr.io/devdownin/novaguard/android-build`, **étiquetée
par le hash du `Dockerfile`**. `build-apk` demande l'étiquette que son propre
commit décrit : une image ne peut donc jamais être décalée du `Dockerfile` avec
lequel la release est construite. Si l'étiquette n'existe pas encore, le job
construit l'image sur place — un tag manquant coûte un téléchargement, il ne
casse pas une release.

`android-image.yml` reconstruit l'image, **vérifie composant par composant**
qu'ils sont sur le disque (un `docker build` qui sort en zéro ne prouve que
l'exécution des commandes), fabrique un APK, et ne publie qu'ensuite. Il est
dans son propre fichier parce que GitHub ne filtre par `paths` qu'au niveau du
workflow, et personne ne doit payer plusieurs gigaoctets de SDK sur une PR
ordinaire.

## Publier sur le Play Store

`scripts/build-aab.sh` produit l'*App Bundle*, la même mécanique de conteneur que
l'APK (`BUILD_SCRIPT` choisit lequel tourne dedans). Ce qu'il faut savoir avant
d'y toucher :

- **Le keystore de debug est commité, et c'est voulu — pour l'APK seulement.**
  Il signe l'artefact qu'on sideload sur un appareil de test. Play le rejette, et
  de toute façon sa clé privée est dans chaque clone. La clé d'upload vient de
  `android/keystore.properties` (git-ignoré), de `~/.gradle/gradle.properties` ou
  de l'environnement. `bundleRelease` **échoue** sans elle plutôt que de produire
  un bundle inutilisable : l'erreur trouvée dans la Play Console, elle, coûte un
  `versionCode` définitivement brûlé.
- **`versionName` est lu depuis `package.json`** ; `versionCode` est le compteur
  d'upload de Play, pas la version marketing, et la CI passe son numéro de run.
- **Ce qui est déclaré dans le manifeste est une déclaration à Google**, pas un
  détail de build : le formulaire *Data safety* répond « aucune donnée
  collectée » sur la foi de l'absence de permission `INTERNET`, et chaque type de
  service de premier plan doit être couvert par sa permission. `playRelease.test.ts`
  tient les deux, plus la liste exacte des permissions — un ajout silencieux par
  fusion de manifeste rendrait la fiche fausse sans qu'une ligne d'ici change.
- **R8 reste désactivé.** Toutes les dépendances lourdes atteignent du natif par
  leur nom : l'activer sans règles vérifiées sur matériel échange des mégaoctets
  contre un crash qu'aucun test unitaire ne voit.

Le reste — clé, secrets, fiche Store, visuels, et le fait que `minSdk = 36`
restreint l'audience à Android 16 — est dans `docs/PLAY_STORE.md`.
