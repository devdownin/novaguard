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

La détection de personnes et d'animaux est faite par un modèle TensorFlow Lite
embarqué dans l'application (EfficientDet-Lite0). La détection de visages
utilise ML Kit, également embarqué et exécuté sur l'appareil. **Aucun de ces
traitements ne passe par un réseau.**

## Aucune transmission

L'application ne demande même pas la permission `INTERNET` : elle est
techniquement incapable d'établir une connexion réseau. Il n'y a donc :

- aucun compte, aucune inscription, aucun identifiant ;
- aucune télémétrie, aucune statistique d'usage, aucun rapport de plantage
  distant ;
- aucune publicité, aucun traceur, aucun SDK d'analyse ;
- aucun partage avec des tiers, puisqu'il n'y a rien à partager.

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
  surveillance.
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
