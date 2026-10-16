# NovaGuard 1.1.0 — nouveautés et prise en main

## Statut vérifié le 16 octobre 2026

La version **1.1.0 est en préparation** dans la [PR #113](https://github.com/devdownin/novaguard/pull/113), au commit [`9511dd0`](https://github.com/devdownin/novaguard/tree/9511dd067ffd9c8c70fd100babc6284556a45415). Cette branche porte la version `1.1.0` dans `package.json`, le lockfile et `APP_VERSION`, ainsi qu’une section dédiée dans le changelog.

À cette date, aucun tag ni APK `v1.1.0` n’est publié. La dernière Release stable reste [`v0.9.5`](https://github.com/devdownin/novaguard/releases/tag/v0.9.5). La carte [Installation du site](https://devdownin.github.io/novaguard/#installer) affiche la version, la date et la taille de l’APK réellement disponible ; elle est actualisée depuis les métadonnées GitHub au déploiement.

Pour essayer les changements avant publication, récupérer l’artefact `novaguard-release-apk` d’un build CI réussi de la **branche ou du commit concerné**, après les vérifications du projet. Un APK provenant d’un ancien tag ou d’une autre branche peut ne pas contenir ces nouveautés. Cette mise à jour documentaire ne crée ni tag, ni Release, ni APK, et ne fusionne pas la PR de préparation.

## Des alertes avec une image

Dans **Réglages → Notifications → Image dans l’alerte**, choisir si l’alerte doit inclure une image de la caméra. L’option est activée par défaut pour une nouvelle installation.

- Le texte est affiché immédiatement ; l’image est ajoutée à la même notification lorsqu’elle est disponible, sans nouvelle sonnerie.
- L’image n’est visible qu’après déverrouillage du téléphone. Cette alerte est réservée au téléphone et n’est pas relayée à une montre.
- Si la notification a été balayée avant l’arrivée de l’image, elle ne réapparaît pas.
- La réception de l’image dépend de la caméra ; son arrivée et son orientation restent à vérifier sur l’appareil cible.

## Compter les passages rapprochés

Une minute minimum sépare les sonneries des alertes de détection. Dans la préparation de la 1.1.0, un nouveau passage pendant ce délai actualise **en silence** la notification encore affichée.

À partir du deuxième passage récent, le texte peut indiquer : « passage n° 3 en 10 min ». Le compteur porte sur une fenêtre glissante de dix minutes ; il ne s’agit pas du total de la journée. La mise à jour garde l’image du premier passage de cette notification, qui ne représente donc pas nécessairement la dernière détection. Une notification déjà balayée ne revient pas à cause de cette actualisation.

Les réglages de notifications et les heures calmes s’appliquent aussi à ces mises à jour. La coupure de la surveillance réinitialise ce suivi temporaire ; l’historique enregistré reste distinct du compteur d’alerte.

## Des heures calmes sans interrompre les vidéos

Dans **Réglages → Notifications**, activer les heures calmes et définir une plage horaire locale, par exemple **22 h → 7 h**. L’option est désactivée par défaut ; les valeurs horaires proposées sont 22 h et 7 h.

Pendant cette plage :

- les alertes de détection et leurs mises à jour silencieuses sont suspendues ;
- la surveillance, la détection et l’enregistrement continuent selon leurs réglages ;
- les passages restent consultables dans l’historique.

La plage peut traverser minuit. Vérifier l’heure et le fuseau du téléphone, puis effectuer un essai dans et hors de la plage.

## Jusqu’à trois zones ignorées

Dans **Réglages → Détection**, définir jusqu’à **trois rectangles** à ignorer, par exemple autour d’une télévision ou d’une partie de fenêtre. Cette exclusion complète la zone de détection.

Le filtre utilise le point bas du sujet, au niveau de ses pieds, comme la zone de détection : une détection dont ce point est dans un rectangle ignoré ne déclenche pas la présence. Une personne passant devant une télévision peut rester détectée si ce point est hors de la zone ignorée. Vérifier le résultat dans la scène réelle, et après un changement d’orientation.

Ces zones filtrent les détections ; elles ne constituent pas un masque de confidentialité et ne floutent pas les images enregistrées. Aucune zone n’est configurée par défaut.

## Ce que l’agent MCP peut consulter

Le serveur reste désactivé par défaut. Avec l’accès en lecture, `novaguard_get_configuration` expose notamment :

- `detection.ignoredZones` : **le nombre** de zones ignorées, sans leurs coordonnées ;
- `notifications.alertPicture` : l’option d’image dans l’alerte ;
- `notifications.quietHours` : heures de début/fin, ou `null` lorsque l’option est désactivée.

Une question utile : « Les heures calmes sont-elles actives et combien de zones sont ignorées ? » Ces nouveaux champs permettent la consultation ; ils n’ajoutent aucune commande pour modifier les heures calmes ou les zones. Ces réglages restent sur le téléphone. Le [guide MCP](../site/guide-mcp.html) décrit la connexion, les jetons et HTTPS.

## Démarrage et libellés des vidéos

La version préparée reprend les corrections de découverte de la caméra : la liste est redemandée tant qu’aucun appareil n’est trouvé, avec des tentatives bornées. Le viseur distingue le démarrage d’une absence de caméra confirmée. L’écran d’accueil reste affiché environ deux secondes pendant que l’application démarre dessous.

Dans la fiche vidéo, les libellés deviennent **Garder / Ne plus garder** et **Effacer / Effacer cette séquence**. Garder un passage l’exempte de la rétention et du nettoyage automatiques ; les suppressions explicites restent des actions de l’utilisateur.

## Compatibilité et vérifications

Android **16 (API 36) minimum** est requis. Les captures du site sont celles fournies par l’utilisateur ; leur version applicative n’est pas précisée et elles ne montrent pas tous les nouveaux réglages de la 1.1.

Les tests de code ne valident pas le capteur, l’encodage, les restrictions Android écran éteint ou le comportement des notifications sur chaque téléphone. Avant de publier le tag de version, dérouler [`DEVICE_CHECKS.md`](DEVICE_CHECKS.md), notamment les alertes avec image, le retour dans la minute, les heures calmes et les zones ignorées.

## Sources de cette présentation

| Sujet | Sources inspectées |
| --- | --- |
| Version et changements regroupés | PR #113, `package.json`, `src/constants/app.ts`, `CHANGELOG.md` au commit `9511dd0` |
| Image dans l’alerte, heures calmes, zones ignorées | `src/state/defaults.ts`, `SetupScreen.tsx`, `src/ml/zone.ts`, `DetectionNotifier.kt` sur `main` (`bbcb338`) |
| Actualisation silencieuse et compteur sur dix minutes | `src/surveillance/alerts.ts`, `AppStateContext.tsx`, `DetectionNotifier.kt` dans la préparation `9511dd0` |
| Configuration MCP | `src/surveillance/mcpServer.ts`, `McpSnapshot.kt`, `mcp.md` sur `main` |
| Limites de validation matérielle | `docs/DEVICE_CHECKS.md`, description de la PR #113 |

Les liens vers la préparation identifient une révision précise. Le statut public de la Release doit être revérifié avant toute annonce de disponibilité de l’APK 1.1.
