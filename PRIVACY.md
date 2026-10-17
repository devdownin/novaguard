# Politique de confidentialité — NovaGuard

*[English version](PRIVACY.en.md)*

**Dernière mise à jour : 5 septembre 2026**

NovaGuard est une application de surveillance qui transforme un téléphone Android
en caméra de détection. Elle est publiée sous licence GPL-3.0 et son code source
est intégralement consultable : <https://github.com/devdownin/novaguard>.

## En une phrase

NovaGuard ne collecte rien, n'envoie rien et n'a pas de serveur. Tout ce que
l'application produit reste sur votre téléphone.

## Ce que l'application traite, et où

| Donnée | Où elle est traitée | Où elle est conservée | Ce qui en sort |
| --- | --- | --- | --- |
| Images de la caméra | Sur l'appareil, en mémoire | Non conservées telles quelles | Rien |
| Détections (personne / animal) | Sur l'appareil, par un modèle embarqué | Historique local (`AsyncStorage`) | Rien |
| Vidéos enregistrées | Sur l'appareil | Répertoire privé de l'application | Rien, sauf partage explicite (voir plus bas) |
| Vignettes des vidéos | Sur l'appareil | Répertoire privé de l'application, supprimées avec leur vidéo | Rien |
| Son (si le micro est autorisé) | Sur l'appareil | Dans la piste audio des vidéos | Rien |
| Réglages et compteurs | Sur l'appareil | Stockage local de l'application | Rien |
| Serveur MCP (optionnel) | Sur l'appareil (port 8081) | Non conservé | Données et médias explicitement demandés par l'assistant IA de l'utilisateur |

La détection de personnes et d'animaux est faite par un modèle TensorFlow Lite
embarqué dans l'application (EfficientDet-Lite0). La détection de visages
utilise ML Kit, également embarqué et exécuté sur l'appareil. **Aucun de ces
traitements ne passe par un réseau.**

## Aucune transmission

L'application déclare la permission `INTERNET` pour trois raisons, toutes
optionnelles et **éteintes par défaut** : le direct Wi-Fi et le serveur MCP, qui
ne font qu'écouter sur le réseau local et ne répondent qu'aux appareils que vous
y connectez vous-même ; et l'accès depuis le cloud, décrit plus bas. Tant que ce
dernier est éteint, NovaGuard n'ouvre aucune connexion sortante, vers aucun
serveur. Il n'y a donc :

- aucun compte, aucune inscription, aucun identifiant ;
- aucune télémétrie, aucune statistique d'usage, aucun rapport de plantage
  distant ;
- aucune publicité, aucun traceur, aucun SDK d'analyse ;
- aucun partage avec des tiers, puisqu'il n'y a rien à partager.

### Accès depuis le cloud (Optionnel)

Si vous activez « Accès depuis le cloud » dans les réglages — après une
confirmation qui nomme le relais —, le téléphone ouvre une connexion **sortante**
vers le relais de NovaGuard, pour que claude.ai, ChatGPT ou Copilot Studio
puissent joindre votre serveur MCP. C'est la seule connexion sortante de
l'application, et elle n'existe que tant que ce réglage est allumé.

- Le relais transmet les requêtes de l'assistant jusqu'au téléphone et ses
  réponses en retour. Il **voit tout ce qui passe**, y compris les images que
  l'assistant demande : le chiffrement va de l'assistant au relais, puis du relais
  au téléphone, pas de bout en bout.
- Il ne conserve rien : ses journaux ne contiennent que l'heure, l'identifiant de
  l'appareil, le statut et la taille d'une requête, jamais son contenu.
- Par ce chemin, l'assistant ne peut que **lire**, avec le jeton d'accès ou avec
  une autorisation que **vous confirmez sur le téléphone** (OAuth) ; le jeton de
  pilotage n'y est pas accepté. La vue en direct y a son propre interrupteur.
  Chaque autorisation est listée dans les réglages et se révoque d'un geste ;
  le téléphone n'en garde que des empreintes, jamais les jetons.
- Le téléphone s'identifie auprès du relais par une clé qui ne quitte jamais
  l'Android Keystore ; l'adresse publique en est dérivée.
- Vous coupez l'accès en éteignant le réglage : la connexion se ferme aussitôt.

L'assistant lui-même est un service tiers : ce qu'il lit part vers le modèle qu'il
utilise, comme pour le serveur MCP local.

### Serveur MCP (Optionnel)

Si vous activez le serveur MCP (*Model Context Protocol*) dans les réglages, un assistant IA de votre choix peut interroger NovaGuard depuis cet appareil ou, avec un jeton d'accès, depuis le réseau local (port 8081 par défaut). Il reçoit les métadonnées de surveillance, les images et les vidéos **qu'il demande explicitement** ; si cet assistant s'appuie sur un modèle distant, ces données quittent alors l'appareil vers le service que vous avez choisi — jamais vers NovaGuard.

Deux capacités supplémentaires sont éteintes par défaut et s'activent séparément :

- **la vue en direct** : l'assistant peut demander une image de ce que voit la caméra pendant la surveillance ; rien n'est enregistré ;
- **le pilotage** : avec un jeton de pilotage distinct, à durée limitée et révocable depuis la notification, l'assistant peut démarrer ou arrêter la surveillance, régler la sensibilité et les seuils, conserver un passage, acquitter une alerte et laisser une note sur un évènement. Il ne peut **rien supprimer**, ni modifier la zone, la rétention ou un jeton. Chaque action est consignée dans les réglages.

La page « Ce qu'un assistant IA peut voir et faire » (Réglages) détaille l'ensemble.


## Qui peut ouvrir l'historique

Le répertoire privé met les vidéos hors de portée des autres applications et du
réseau ; il ne les met pas hors de portée de la personne qui prend le téléphone
en main. **Réglages ▸ Stockage ▸ Verrouiller l'historique** ajoute cette
moitié-là : l'onglet Historique et l'ouverture d'une vidéo demandent alors la
confirmation de l'appareil — empreinte, visage, ou le code de verrouillage.
L'option est désactivée par défaut, la confirmation est demandée à Android (rien
n'est stocké par l'application), et elle retombe dès que l'application quitte
l'écran. Sur un téléphone sans verrouillage d'écran configuré, le réglage
l'indique au lieu de laisser croire à une protection.

## La seule sortie possible, et c'est vous qui l'ouvrez

Les vidéos sont écrites dans le répertoire privé de l'application, qu'aucune
autre application ne peut lire. Le bouton **Partager** du détail d'un évènement
ouvre le sélecteur Android et transmet **ce fichier-là** à l'application que vous
choisissez, par une autorisation temporaire. Rien ne sort sans ce geste, et ce
que l'application destinataire en fait relève de sa propre politique.

## Permissions demandées et pourquoi

- **Caméra** — indispensable : c'est le flux analysé et enregistré.
- **Microphone** — facultatif : ajoute le son aux enregistrements. Refuser ne
  désactive pas la surveillance.
- **Notifications** — facultatif : alerte lors d'une détection, et notification
  permanente signalant que la caméra est active. Refuser ne désactive pas la
  surveillance. L'alerte peut porter une image de ce que voit la caméra
  (réglable) : elle n'est visible qu'après déverrouillage et n'est jamais
  transmise à une montre ou à un autre appareil connecté.
- **Service de premier plan (caméra / microphone)** — permet à la surveillance
  de continuer écran éteint. Sans lui, Android coupe la caméra dès que
  l'application n'est plus visible.

## Suppression des données

- Une vidéo se supprime depuis son détail dans l'historique.
- **Setup → Stockage → Supprimer toutes les vidéos** efface l'ensemble.
- Une rétention automatique (1 à 90 jours, ou « Toujours ») supprime les clips
  au-delà du délai choisi.
- **Désinstaller l'application supprime tout** : vidéos, historique et réglages
  vivent dans son stockage privé et disparaissent avec elle.

Aucune donnée ne survit à la désinstallation, et il n'existe aucune copie
ailleurs qu'il faudrait vous faire effacer.

## Enfants

L'application ne s'adresse pas aux enfants et ne collecte aucune donnée, quel
que soit l'âge de l'utilisateur.

## Votre responsabilité de filmer

NovaGuard est un outil de captation vidéo. Selon le pays, filmer des personnes
— y compris chez soi, et a fortiori un espace partagé ou la voie publique — est
encadré par la loi (en France, RGPD et article 226-1 du code pénal). L'usage que
vous faites de l'application, les lieux que vous filmez et l'information des
personnes concernées relèvent de vous, pas de l'éditeur.

## Modifications

Toute modification de cette politique sera publiée dans ce fichier, dont
l'historique complet est consultable dans le dépôt Git.

## Contact

Par les *issues* du dépôt : <https://github.com/devdownin/novaguard/issues>
