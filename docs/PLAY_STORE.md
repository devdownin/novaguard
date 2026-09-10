# Publier NovaGuard sur Google Play

Ce que le dépôt fait désormais tout seul, ce qui reste à faire à la main, et ce
qui bloque encore. À jour du 4 septembre 2026.

---

## 0. Le point bloquant à trancher avant tout le reste

**`minSdk = 36` (Android 16) réduit la cible à une fraction des appareils.**

C'est un choix assumé et documenté (`android/build.gradle`, `CLAUDE.md`) : un
seul niveau de plateforme, donc aucune branche de compatibilité dans tout le
code. Pour un dépôt open source dont les APK sont sideloadés, c'est défendable.
Sur le Play Store, cela veut dire qu'à la publication l'immense majorité des
téléphones en circulation verront « Cet appareil n'est pas compatible ».

Trois options, à choisir **avant** de créer la fiche Store :

1. **Publier tel quel.** Cohérent avec le code actuel, audience minuscule au
   départ, qui grandit mécaniquement avec le parc.
2. **Descendre `minSdk`** (24 → 34 selon l'ambition). Ce n'est pas un
   changement d'une ligne : il faut réintroduire les branches que ce projet a
   supprimées — types de services de premier plan (API 34), `POST_NOTIFICATIONS`
   (33), edge-to-edge, comportements de `MediaRecorder`. À traiter comme un
   chantier à part entière, avec des tests, pas comme un réglage.
3. **Publier en test fermé/ouvert** le temps de décider, ce qui permet de
   valider toute la chaîne (signature, bundle, fiche, Data safety) sans
   engager une note publique.

Rien d'autre dans ce document ne dépend de ce choix — mais le nombre
d'installations, si.

---

## 1. Ce qui est déjà en place dans le dépôt

| Élément | État |
| --- | --- |
| Signature de release par clé d'upload | ✅ `android/app/build.gradle`, credentials hors dépôt |
| Refus de produire un AAB signé en debug | ✅ échec explicite de `bundleRelease` |
| Construction de l'AAB | ✅ `scripts/build-aab.sh` + job `build-aab` sur tag |
| `versionName` unique, depuis `package.json` | ✅ |
| `versionCode` pilotable par la CI | ✅ `-PnovaguardVersionCode=` (numéro de run) |
| Politique de confidentialité, fr + en | ✅ [`PRIVACY.md`](../PRIVACY.md), [`PRIVACY.en.md`](../PRIVACY.en.md) — restent à publier à une URL |
| Icône 512×512 | ✅ `assets/store/icon-512.png` |
| Permissions justifiables une par une | ✅ vérifié par `__tests__/playRelease.test.ts` |
| Absence de permission réseau | ✅ vérifiée par le même test |
| Fiche Store, fr-FR et en-US | ✅ § 5, à coller dans la Console |
| Visuel de présentation 1024×500 | ❌ à produire |
| Captures d'écran | ❌ à produire sur appareil |
| Compte développeur Play (25 $, vérification d'identité) | ❌ hors dépôt |

---

## 2. Créer la clé d'upload (une fois, et à ne jamais perdre)

Avec **Play App Signing** (activé par défaut sur toute nouvelle application),
Google détient la clé de signature finale ; la clé ci-dessous ne sert qu'à
*téléverser*. Elle est donc remplaçable si elle est perdue — mais seulement par
une procédure d'assistance, alors sauvegardez-la quand même.

```bash
keytool -genkeypair -v \
  -keystore upload.jks \
  -alias novaguard-upload \
  -keyalg RSA -keysize 4096 -validity 10000
```

Trois endroits possibles pour les identifiants, jamais le dépôt :

- `android/keystore.properties` (git-ignoré) :

  ```properties
  novaguard.uploadStoreFile=/chemin/absolu/upload.jks
  novaguard.uploadStorePassword=…
  novaguard.uploadKeyAlias=novaguard-upload
  novaguard.uploadKeyPassword=…
  ```

- `~/.gradle/gradle.properties`, avec les mêmes clés ;
- l'environnement : `NOVAGUARD_UPLOADSTOREFILE`, `NOVAGUARD_UPLOADSTOREPASSWORD`,
  `NOVAGUARD_UPLOADKEYALIAS`, `NOVAGUARD_UPLOADKEYPASSWORD`.

Sans aucun des trois, l'APK se construit toujours (signé par le keystore de
debug, pour un appareil de test) et `bundleRelease` échoue avec le message qui
renvoie ici.

### Secrets GitHub pour le job `build-aab`

| Secret | Contenu |
| --- | --- |
| `PLAY_UPLOAD_KEYSTORE_BASE64` | `base64 -w0 upload.jks` |
| `PLAY_UPLOAD_STORE_PASSWORD` | mot de passe du keystore |
| `PLAY_UPLOAD_KEY_ALIAS` | `novaguard-upload` |
| `PLAY_UPLOAD_KEY_PASSWORD` | mot de passe de la clé |

Le job écrit le keystore hors du checkout, le monte en lecture seule dans le
conteneur et le supprime quoi qu'il arrive.

---

## 3. Construire le bundle

```bash
# En local, avec la chaîne d'outils du dépôt
docker build -t novaguard-android .
BUILD_SCRIPT=scripts/build-aab.sh SIGNING_DIR=/chemin/du/dossier/keystore \
  scripts/build-apk-in-docker.sh novaguard-android
# → android/app/build/outputs/bundle/release/app-release.aab
```

En CI : pousser un tag `vX.Y.Z`. Le job `build-aab` produit l'artefact
`novaguard-play-bundle`, **non attaché à la Release GitHub** — un bundle signé
n'a pas sa place sur une page de téléchargement publique à côté de l'APK.

Avant le tag : `npm version <patch|minor|major>` met à jour `package.json`, d'où
le `versionName` est lu. Le `versionCode`, lui, est le numéro de run : Play
refuse un code déjà vu, et un compteur qu'un humain doit penser à incrémenter
est un compteur oublié exactement une fois.

---

## 4. Formulaire *Data safety* (Sécurité des données)

Réponses, toutes vérifiables dans le code :

- **Collectez-vous ou partagez-vous des données utilisateur ?** → **Non.**
- Aucune catégorie à cocher (ni photos/vidéos, ni audio, ni position, ni
  identifiants, ni diagnostics).
- **Les données sont-elles chiffrées en transit ?** → sans objet, aucune donnée
  ne transite. L'application ne déclare pas `INTERNET`.
- **L'utilisateur peut-il demander la suppression de ses données ?** → oui, tout
  est local : suppression unitaire, « Tout supprimer », rétention automatique, et
  la désinstallation efface tout.

Justification à garder sous la main : les vidéos et l'historique sont écrits
dans le stockage privé de l'application ; le seul chemin sortant est le bouton
« Partager », déclenché par l'utilisateur, via un `FileProvider` qui n'accorde
qu'une URI temporaire sur un fichier.

## Déclaration des services de premier plan

Play demande une justification écrite **par type**, plus une courte vidéo
montrant la fonctionnalité.

- **`camera`** — « L'application est une caméra de surveillance. La détection et
  l'enregistrement doivent continuer lorsque l'écran est éteint ou que
  l'application est en arrière-plan ; sans service de premier plan de type
  `camera`, Android coupe l'accès au capteur dès que l'application cesse d'être
  visible et la surveillance s'arrête. Une notification permanente signale que
  la caméra est active. »
- **`microphone`** — « Ajoute le son aux enregistrements lorsque l'utilisateur a
  accordé la permission micro. Le type n'est revendiqué au démarrage du service
  que si `RECORD_AUDIO` est effectivement accordée (voir
  `SurveillanceService.foregroundTypes()`). »

## Autres déclarations

- **Autorisations sensibles** : caméra et microphone, tous deux au cœur de la
  fonctionnalité principale ; aucune permission de localisation, de stockage
  partagé, de contacts, ni `QUERY_ALL_PACKAGES`.
- **Publicités** : non.
- **Achats intégrés** : non.
- **Classification du contenu** : questionnaire IARC — aucune violence, aucun
  contenu sexuel, aucun contenu généré par les utilisateurs partagé, aucune
  interaction sociale, aucune donnée personnelle transmise.
- **Public cible** : 18 ans et plus (outil de surveillance).
- **Application gouvernementale / COVID / finance** : non.

---

## 5. Fiche Store

Play tient **une fiche par langue**, avec une langue par défaut et des
traductions. L'application choisit désormais le français pour un appareil
francophone et l'anglais pour tous les autres (`src/i18n`) : publier une fiche
en français seulement offrirait à la moitié de ses utilisateurs potentiels une
page qu'ils ne lisent pas pour une application qu'ils comprendraient.

Les deux brouillons ci-dessous sont à coller tels quels dans **Présence sur le
Store → Fiche Play Store principale**, `fr-FR` puis `en-US`. Les compteurs sont
les limites de Play ; les longueurs indiquées sont celles de ces textes.

### fr-FR

**Nom** (30 max, ici 25)
`NovaGuard — Caméra locale`

**Description courte** (80 max, ici 78)
`Transformez un téléphone en caméra de surveillance. Tout reste sur l'appareil.`

**Description complète** (4 000 max, ici 1 867)

```
NovaGuard transforme un téléphone Android en caméra de surveillance
intelligente. La détection et l'enregistrement se font entièrement sur
l'appareil : pas de compte, pas de serveur, pas d'abonnement.

DÉTECTION SUR L'APPAREIL
Personnes et animaux sont reconnus en local par un modèle embarqué. Un sujet
doit être vu sur plusieurs images consécutives avant de déclencher un
enregistrement, ce qui évite les fausses alertes, et une occlusion brève ne
coupe pas l'évènement en deux.

ENREGISTREMENT AUTOMATIQUE
Chaque détection confirmée écrit une vidéo, nommée d'après ce qui l'a
déclenchée. Qualité (720p, 1080p, 4K), durée après détection et durée maximale
d'un clip sont réglables.

ZOOM AUTOMATIQUE
Quand quelqu'un est détecté, le cadrage glisse doucement sur la personne
entière, s'y maintient, puis revient en plan large sur la scène.

SURVEILLANCE ÉCRAN ÉTEINT
Un service de premier plan garde la caméra active en arrière-plan, avec une
notification permanente indiquant que l'enregistrement est possible.

HISTORIQUE ET STOCKAGE
Les évènements sont filtrables par type et par période, avec relecture de la
vidéo. Rétention configurable de 1 à 90 jours, suppression automatique des plus
anciens clips quand l'espace manque.

CONFIDENTIALITÉ PAR CONCEPTION
Les vidéos sont écrites dans le stockage privé de l'application : aucune autre
application ne peut les lire, rien n'apparaît dans la galerie partagée, et tout
disparaît à la désinstallation. NovaGuard ne demande même pas la permission
d'accéder à Internet — elle est techniquement incapable d'envoyer quoi que ce
soit. Le seul moyen de faire sortir une vidéo est le bouton « Partager », que
vous seul déclenchez.

Code source complet, sous licence GPL-3.0 :
https://github.com/devdownin/novaguard

Vous restez responsable de ce que vous filmez : selon le pays, filmer des
personnes est encadré par la loi.
```

### en-US

**Name** (30 max, here 24)
`NovaGuard — Local Camera`

**Short description** (80 max, here 68)
`Turn a phone into a security camera. Everything stays on the device.`

**Full description** (4,000 max, here 1,714)

```
NovaGuard turns an Android phone into a smart security camera. Detection and
recording happen entirely on the device: no account, no server, no subscription.

ON-DEVICE DETECTION
People and animals are recognised locally by a bundled model. A subject has to
be seen in several consecutive frames before a recording starts, which keeps
false alarms out, and a brief occlusion does not split one event in two.

AUTOMATIC RECORDING
Every confirmed detection writes a video, named after what triggered it.
Quality (720p, 1080p, 4K), how long recording continues after a detection, and
the maximum length of a clip are all adjustable.

AUTOMATIC ZOOM
When someone is detected, the framing eases in on that person, whole, holds
there, then pulls back to a wide shot of the scene.

MONITORING WITH THE SCREEN OFF
A foreground service keeps the camera running in the background, with an
ongoing notification showing that recording is possible.

HISTORY AND STORAGE
Events can be filtered by type and by period, and each one plays back in place.
Retention is configurable from 1 to 90 days, and the oldest clips are deleted
automatically when space runs short.

PRIVACY BY DESIGN
Videos are written to the app's private storage: no other app can read them,
nothing shows up in the shared gallery, and everything disappears when the app
is uninstalled. NovaGuard does not even ask for internet permission — it is
technically incapable of sending anything anywhere. The only way a video ever
leaves is the Share button, which only you press.

Full source code, under the GPL-3.0 licence:
https://github.com/devdownin/novaguard

What you film remains your responsibility: in many countries, filming people is
regulated by law.
```

### Le reste de la fiche, commun aux deux langues

**URL de la politique de confidentialité** — une par langue :
[`PRIVACY.md`](../PRIVACY.md) pour `fr-FR`, [`PRIVACY.en.md`](../PRIVACY.en.md)
pour `en-US`. Les deux doivent être servies à une adresse publique et stable ; le
plus simple sans infrastructure est d'activer GitHub Pages sur le dépôt, ou de
pointer sur la vue GitHub du fichier. Les deux versions se répondent (lien
croisé en tête) et `playRelease.test.ts` refuse qu'elles divergent en structure
ou en date — une politique qui ne décrit plus l'application est pire qu'une
absence de traduction : c'est une affirmation fausse sur ce qu'il advient de la
vidéo de quelqu'un.

**Catégorie** : Outils / Tools. **Étiquettes** : sécurité, caméra, surveillance.
**Coordonnées** : e-mail de contact obligatoire et affiché publiquement sur la
fiche — prévoir une adresse dédiée plutôt qu'une adresse personnelle.

**Captures d'écran** : Play les demande **par langue**. Les mêmes images peuvent
servir aux deux fiches, mais elles montreront l'interface dans la langue de
l'appareil qui les a produites — donc deux jeux, ou un jeu neutre, à décider en
même temps que les captures elles-mêmes (§ 6).

**Ce qui reste à relire** : les textes anglais ci-dessus, la politique de
confidentialité anglaise et le catalogue `src/i18n/en.ts` n'ont pas été relus par
un anglophone natif. Ils sont écrits avec soin et tiennent dans les limites de
Play, mais une relecture reste à faire — une faute sur la fiche est la première
chose que voit un visiteur du Store, et la politique est le seul document qu'un
examinateur lit en entier.

---

## 6. Éléments graphiques à produire

| Élément | Format | État |
| --- | --- | --- |
| Icône | 512×512 PNG 32 bits | ✅ `assets/store/icon-512.png` |
| Visuel de présentation | 1024×500 PNG/JPEG | ❌ |
| Captures téléphone | 2 à 8, 16:9 ou 9:16, ≥ 1080 px sur le petit côté | ❌ |
| Vidéo de démonstration des services de premier plan | non listée, requise par le formulaire | ❌ |

Les captures doivent venir d'un appareil réel : le viseur, les cadres de
détection et l'incrustation REC ne peuvent pas être rendus dans cet
environnement de build. Écrans à couvrir : Surveillance (active, avec un cadre
de détection), Historique, détail d'un évènement, Setup.

---

## 7. Ce qui reste ouvert, honnêtement

- **Rien de tout cela n'a été exécuté sur un appareil.** Ni SDK Android ni
  émulateur ici : la configuration de signature, le bundle et le job CI sont
  écrits mais **jamais construits**. Le premier `bundleRelease` réel est à faire
  avant de promettre une date.
- **R8 / minification reste désactivé** (`enableProguardInReleaseBuilds`). Toutes
  les dépendances lourdes atteignent du code natif par leur nom (VisionCamera,
  LiteRT, ML Kit, worklets) : l'activer sans règles vérifiées sur matériel
  échange quelques mégaoctets contre un crash qu'aucun test unitaire ne voit.
  À traiter séparément, avec un appareil.
- **Pré-lancement Play** : le rapport de test automatique de Play utilise des
  appareils virtuels dont la caméra est simulée. Prévoir des remontées bizarres
  côté capteur, sans conclure trop vite à un bug.
- **Nom « NovaGuard »** : vérifier qu'aucune application homonyme ne rend le nom
  refusable, et que la marque n'est pas déposée par un tiers dans la catégorie.
