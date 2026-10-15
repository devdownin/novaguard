# Site marketing NovaGuard

Site statique français, sans compilation ni dépendance npm. Les fichiers de `site/`, `scripts/update-site-release.py` et `.github/workflows/static.yml` s’intègrent dans le dépôt existant. Les autres workflows Android ne sont pas modifiés.

## Déploiement GitHub Pages

1. Ajouter `site/` au dépôt et remplacer `.github/workflows/static.yml` par la version fournie.
2. Dans **Settings → Pages → Build and deployment → Source**, sélectionner **GitHub Actions**.
3. Une modification de `site/`, du générateur de téléchargement ou de ce workflow poussée sur `main` déclenche le déploiement. La publication/édition d’une Release et une exécution quotidienne actualisent également la version affichée et son APK. Le workflow peut aussi être lancé manuellement depuis **Actions → Deploy NovaGuard website to Pages**, sur `main`.
4. L’URL publiée apparaît dans l’environnement `github-pages`. Pour le dépôt public sans domaine personnalisé, l’URL attendue est `https://devdownin.github.io/novaguard/` ; elle n’est confirmée qu’après un déploiement réussi.

Le workflow envoie uniquement `site/` à Pages, au lieu de publier l’ensemble du dépôt. Les chemins locaux sont relatifs : le site fonctionne sous `/novaguard/`, à la racine d’un domaine, ou en prévisualisation locale. Aucun secret supplémentaire ni installation Android ne sont nécessaires.

Le workflow utilise `checkout@v4`, `configure-pages@v5`, `upload-pages-artifact@v3` et `deploy-pages@v4`. Les écritures Pages et le jeton OIDC sont limités au job de déploiement, qui publie toujours les fichiers de `main`, y compris lorsqu’une Release déclenche le workflow. Les déploiements en cours ne sont pas annulés.

## Prévisualisation locale

Depuis la racine du dépôt :

```sh
python3 -m http.server 8000 --directory site
```

Ouvrir `http://localhost:8000`. Le site ne nécessite aucun backend. Le sélecteur des deux modes est un bouton de présentation ; il ne se connecte pas à une caméra. Sans JavaScript, les deux présentations restent lisibles. Les questions utilisent les éléments HTML natifs `details` et `summary`.

Les illustrations SVG sont créées pour cette présentation. La vue du téléphone est explicitement indiquée comme une illustration, pas comme une capture de l’application ni comme une détection réelle. Aucune police, image ou bibliothèque n’est chargée depuis un service tiers. Aucun formulaire, cookie d’analyse ou traceur n’est ajouté.

## Analyse du projet et positionnement

Analyse du commit [`4ae59eed60eb8ae803fb29292a936b9dba3897f5`](https://github.com/devdownin/novaguard/tree/4ae59eed60eb8ae803fb29292a936b9dba3897f5), branche `main`, consultée le 15 octobre 2026. Les observations ci-dessous proviennent de la documentation et de l’inspection du code ; elles ne constituent pas une validation sur téléphone.

**Proposition de valeur :** transformer un Android compatible en caméra locale de détection de personnes et d’animaux, utilisable seule ou ouverte volontairement à un agent IA via le serveur MCP du téléphone.

**Publics :** utilisateurs disposant d’un Android 16 et souhaitant observer un espace privé, adeptes d’outils open source et utilisateurs d’agents compatibles MCP. L’accroche ne promet pas de recycler n’importe quel vieux téléphone : le minimum Android 16 exclut de nombreux appareils.

**Bénéfices mis en avant :** retrouver les passages utiles ; garder les clips localement ; demander une synthèse à son agent ; choisir séparément l’accès en lecture et le pilotage. Aucun tarif, abonnement, avis client, certification, disponibilité Play Store ou taux de détection n’est inventé.

| Message du site | Source vérifiée | Limite à conserver dans le discours |
| --- | --- | --- |
| Détection et enregistrement locaux | `README.md`, `src/state/defaults.ts` | La reconnaissance est une estimation ; les passages non reconnus ne peuvent pas être récupérés. |
| Personnes et animaux, sensibilité configurable | `README.md`, `src/state/defaults.ts` | Aucune promesse d’identification de personnes, de reconnaissance biométrique ou de précision garantie. |
| Clips privés et partage volontaire | `README.md`, `AndroidManifest.xml` (`FileProvider`, `allowBackup=false`) | Partage, direct Wi-Fi et MCP peuvent ouvrir un accès volontaire aux données. |
| Deux modes, MCP optionnel | `mcp.md`, `src/state/defaults.ts` (`mcpEnabled=false`) | L’agent IA n’est pas nécessaire au pipeline de vision. |
| Consultation d’événements, images et diagnostics | `mcp.md`, `McpCatalog.kt` | L’agent raisonne sur les éléments disponibles, pas sur une connaissance exhaustive de la scène. |
| Pilotage séparé, révocable et non destructif | `mcp.md`, `mcpCommands.ts`, `McpCatalog.kt` | Six commandes seulement ; démarrage refusé si l’application n’est pas au premier plan. |
| Android 16 minimum | `android/build.gradle` (`minSdkVersion=36`) | La compatibilité et les performances restent à tester sur le modèle cible. |
| Installation par APK et artefacts CI | `.github/workflows/ci.yml`, `android/app/build.gradle` | L’APK CI utilise la clé de debug ; un bundle Play signé n’est pas une preuve de disponibilité sur le Store. |
| Direct Wi-Fi local optionnel | `README.md`, `localStreamServer.ts`, `src/state/defaults.ts` | JPEG à 1 image/s, HTTP sans chiffrement ; réseau local de confiance seulement. |

### Workflows examinés

- **`ci.yml`** : types, lint, tests JS et règles natives, vérification XML ; production d’APK sur `main`, tags et lancement manuel, ainsi que sur les PR affectant le natif. APK joint aux Releases sur tag ; bundle Play distinct avec clé d’upload.
- **`android-image.yml`** : construction et validation de l’image de compilation Android, test d’un APK, puis publication de l’image depuis `main`.
- **`security.yml`** : vérification TypeScript et tests ciblés sur le branchement MCP et la confidentialité.
- **`static.yml`** : workflow Pages déjà présent, publiant `.` ; aucun fichier HTML/CSS n’apparaît dans l’arborescence analysée. La version proposée publie la nouvelle racine `site/` uniquement.

### Incohérences et limites documentaires de l’analyse initiale

`PRIVACY.md`, daté du 5 septembre 2026, affirme que l’application ne demande pas `INTERNET` et que MCP est strictement en lecture seule. Le manifeste déclare pourtant `android.permission.INTERNET`, et `mcpCommands.ts` / `McpCatalog.kt` exposent six commandes de pilotage sous autorisation. Le site décrit ces possibilités sans reprendre les affirmations devenues obsolètes. Cette observation concerne le commit initial analysé. Les PR #105 et #107 ont depuis mis la politique en cohérence ; leur état a été intégré à la branche du site avec `main` au commit `13877c0b7db5380533dd4d48b85d49e49045a928`.

`mcp.md` utilise des noms pointés (`novaguard.get_status`), alors que `McpCatalog.kt` annonce des noms à underscore (`novaguard_get_status`) et documente la compatibilité avec les noms pointés. Le guide utilise les noms à underscore annoncés par le catalogue et le format JSON réellement construit par `SetupScreen.tsx` (`mcpServers`, `url`, `headers.Authorization`).

La feuille de route du README garde une case de partage non cochée alors que sa description fonctionnelle et le `FileProvider` du manifeste indiquent cette fonction. Le site parle de la fonction implémentée sans prétendre l’avoir validée matériellement.

La documentation indique encore des validations à réaliser sur appareil : capture réelle, orientation, alignement des cadres, continuité et écran éteint, ainsi que certaines opérations MCP. Le site les mentionne dans le parcours d’essai et la FAQ. Aucune garantie de surveillance continue, de sécurité certifiée ou d’alerte distante n’est annoncée.

### Périmètre de livraison

Les sources du site et le workflow sont proposés dans une branche dédiée pour revue. L’activation de Pages reste une étape d’administration du dépôt ; le déploiement du site est prévu après intégration sur `main`. Les contrôles du site ne valident pas l’application Android. Après intégration sur `main`, vérifier le déploiement réel et l’accès aux APK disponibles dans les Releases ou les artefacts CI (connexion GitHub éventuellement nécessaire pour ces derniers).

## Vérifications effectuées

Le 15 octobre 2026, sur les fichiers livrés :

- Syntaxe JavaScript : `node --check site/app.js`, succès.
- Vérification statique Python : liens locaux et ancres, unicité des identifiants, références ARIA, XML des SVG et structure YAML du workflow, succès. L’artefact Pages contient exclusivement `site/`.
- Chromium piloté par Playwright : rendu à 1440, 1024, 768, 390 et 320 pixels, sans débordement horizontal ; changement des deux modes et cohérence de `aria-pressed`, ouverture/fermeture de la FAQ, succès.
- Navigation au clavier du sélecteur et repli sans JavaScript : les deux modes et la FAQ restent accessibles, succès.
- Aucun échec HTTP pour les ressources locales ni erreur JavaScript pendant ces parcours.
- Serveur HTTP local monté sous `/novaguard/` : chargement CSS/JS/SVG, ancre d’installation et changement de mode, succès.
- Inspection visuelle des aperçus bureau et mobile.
- Les références publiques `actions/deploy-pages@v4` et `actions/upload-pages-artifact@v3` ont été consultées ; les Releases du projet contiennent notamment un APK `app-release.apk` pour `v0.9.5`. La carte de téléchargement affiche ce fichier, sa version, sa date et sa taille ; elle est régénérée à chaque déploiement depuis les métadonnées de la dernière Release stable.

Les tests de navigateur ont été exécutés via des scripts temporaires de vérification, sans ajouter de dépendance au projet. L’exécution distante de GitHub Actions, les paramètres Pages du compte et les performances réelles de l’application Android ne sont pas vérifiés par ces contrôles.

### Vérifications avant ouverture de la PR

- `npm run typecheck` : succès.
- `npm run lint` : succès, avec 58 avertissements préexistants dans `src/utils/qr.ts` ; `eslint site/app.js` seul ne produit ni erreur ni avertissement.
- `npm test -- --ci --runInBand` : 929 tests réussis, 1 échec (`historyBrowsing.test.tsx`, test « gives the clock, not the day the heading above it already gives »). Le même échec a été reproduit dans un worktree propre du commit de base `4ae59eed60eb8ae803fb29292a936b9dba3897f5` avec la commande ciblée `npm test -- --ci --runInBand __tests__/historyBrowsing.test.tsx` : 12 tests réussis, 1 échec. Ce défaut préexistant ne concerne pas le site et n’est pas modifié.
- `scripts/test-presence-native.sh` : non exécuté jusqu’au bout, car `javac` n’est pas installé dans l’environnement local. Le job CI installe Java 17.
- Les parcours Chromium, les cinq largeurs et le montage HTTP sous `/novaguard/` ont été rejoués avec succès sur les fichiers formatés de la branche de PR.
- L’application Android n’a pas été exécutée sur appareil ou émulateur : la modification concerne exclusivement le site statique, son workflow Pages et cette documentation.


## Guide MCP et téléchargement direct

`site/guide-mcp.html` décrit le parcours réel dans les réglages, le jeton de lecture, la connexion LAN, HTTPS avec l’autorité du téléphone, le format JSON des clients compatibles et les premières questions. Les permissions de lecture, de vue en direct et de pilotage sont présentées séparément. L’exemple utilise une adresse fictive et un jeton explicitement factice ; aucun secret n’est demandé sur le site. Le bouton copie cet exemple localement, avec une aide de copie manuelle si le presse-papiers est indisponible. Sans JavaScript, le JSON reste lisible et sélectionnable.

La carte d’installation affiche le dernier APK stable **publié** et les prérequis avant le bouton. Au moment de l’implémentation, il s’agit de `v0.9.5`, publié le 14 septembre 2026, fichier `app-release.apk`, 106 259 917 octets. Les fonctions documentées sur `main` ne sont pas toutes nécessairement dans cet APK ancien : le site le précise et renvoie aux builds CI pour les ajouts récents.

Au déploiement, `gh api repos/devdownin/novaguard/releases/latest` produit les métadonnées, puis `scripts/update-site-release.py` régénère uniquement la carte balisée dans `index.html`. Le script valide les URL GitHub du dépôt et échappe le texte ; il n’exécute aucun contenu des Releases. S’il n’existe pas d’APK unique ou nommé `app-release.apk`, il propose la page des fichiers au lieu de choisir arbitrairement une architecture. Il refuse les brouillons/préversions et les métadonnées invalides. Le site publié ne dépend pas d’un appel API dans le navigateur. Le rafraîchissement quotidien prend en compte les APK ajoutés après l’événement de publication d’une Release.

Pour actualiser localement :

```sh
gh api repos/devdownin/novaguard/releases/latest > /tmp/novaguard-release.json
python3 scripts/update-site-release.py --metadata /tmp/novaguard-release.json
```

## Captures Android et démonstration vidéo demandées

Les points 1 et 2 de la demande d’amélioration exigent des médias de l’application réelle. L’arborescence de `main` ne contient ni captures Surveillance/Historique/Réglages ni vidéo de ce parcours. Cet environnement ne dispose pas d’ADB, du SDK/émulateur Android ou d’un appareil connecté. Les sources ont été demandées à l’utilisateur ; elles restent nécessaires pour remplacer l’illustration et publier une démonstration réelle. Aucun visuel généré ou résultat fictif n’est présenté comme une capture réelle. Le brief de capture se trouve dans `docs/SITE_MEDIA.md`.

### Vérification de la mise à jour guide/installation

Après intégration de `main` (`13877c0`) : `npm run typecheck` et `npm run lint` réussissent sans erreur ni avertissement ; `npm test -- --ci --runInBand` réussit avec **89 suites et 956 tests**. Le défaut historique mentionné dans les vérifications initiales a été corrigé en amont, sans modification de ce test dans le diff du site.

Les deux pages ont été parcourues sous le préfixe HTTP `/novaguard/` à 1440, 1024, 768, 390 et 320 px : pas de débordement horizontal, navigation vers le guide et retour à l’installation, presse-papiers au clavier et message de repli en cas de refus, FAQ et téléchargement sans JavaScript. Les ressources locales répondent sans erreur et les parcours ne produisent pas d’erreur JavaScript. Les ancres interpages, identifiants, références ARIA, SVG et permissions/structure du workflow ont été contrôlés.

Le générateur a été exécuté avec les métadonnées publiques réelles et avec des cas de vérification : absence de fichier, plusieurs architectures sans APK universel, texte HTML dans une version, URL de téléchargement inattendue, brouillon/préversion, marqueur absent ou en double et seconde génération identique. Ces cas ont passé leurs assertions. Le lien direct de l’APK répond à une requête HEAD avec un statut HTTP 200, le type `application/vnd.android.package-archive` et une taille de 106 259 917 octets.

Les points médias 1 et 2 demeurent **en attente des fichiers source**. Les contrôles du site et du générateur ne constituent pas un essai de capture ou d’enregistrement Android.
