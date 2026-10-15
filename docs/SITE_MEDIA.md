# Médias réels pour le site NovaGuard

Éléments nécessaires pour terminer les points 1 et 2 de la demande : captures réelles Android et courte démonstration du parcours détection → clip → question à l’agent. Les fichiers sont absents du dépôt au moment de la préparation. Le site conserve donc son illustration explicitement légendée.

## Trois captures Android

Utiliser un APK récent sur Android 16, avec sa version et le modèle de téléphone indiqués dans la livraison des médias :

1. **Surveillance** : une personne consentante détectée, cadre visible et état de surveillance lisible.
2. **Historique** : le passage correspondant, avec un clip réellement lisible. Les horaires, la durée et les événements ne doivent pas être inventés.
3. **Réglages** : les options de détection/enregistrement ou le bloc MCP, en masquant les secrets. Ne pas inclure de jeton, configuration JSON personnelle, QR de connexion, adresse privée inutile ou notification personnelle.

Privilégier le PNG natif, en portrait, sans encadrement de téléphone ajouté. Une capture peut être récupérée avec ADB depuis un appareil connecté, après autorisation du débogage USB :

```sh
adb exec-out screencap -p > surveillance.png
```

Naviguer sur le téléphone jusqu’à chaque écran avant de lancer la commande correspondante. Ne pas remplacer une capture native par un rendu HTML ou une illustration.

## Démonstration de 20 à 35 secondes

- **0–8 s** : l’application surveille ; un passage consenti déclenche la détection et l’enregistrement.
- **8–17 s** : ouvrir l’historique et lire le clip de ce passage.
- **17–30 s** : montrer un client MCP réellement connecté et la question « Montre-moi la dernière détection et examine ses images ». Conserver la réponse réelle de l’agent, y compris ses limites.

Le téléphone et le client sur ordinateur peuvent être fournis en deux clips séparés. Fournir également les mots réellement prononcés s’il y a une narration, pour ajouter une transcription accessible. Une vidéo MP4 H.264, sans musique sous droits non autorisés, convient au lecteur HTML natif. Prévoir une image d’affiche issue de cette vidéo ; pas de lecture automatique ni de chargement complet imposé au visiteur.

Pour un enregistrement Android, lancer puis effectuer le parcours sur le téléphone. Arrêter avec Ctrl+C :

```sh
adb shell screenrecord --time-limit 35 /sdcard/novaguard-demo.mp4
adb pull /sdcard/novaguard-demo.mp4
```

Utiliser uniquement des scènes et personnes dont la publication est autorisée. Avant intégration, vérifier visuellement tous les médias pour éviter de publier des jetons, QR, notifications, visages ou lieux non destinés au public.

## Intégration prévue après réception

- Optimiser les trois captures, conserver les proportions natives et ajouter des textes alternatifs descriptifs.
- Remplacer le visuel illustratif du téléphone par la capture Surveillance et ajouter une galerie Historique/Réglages.
- Ajouter un lecteur HTML `video` avec commandes, `preload="none"`, image d’affiche et transcription du contenu. Si une parole est présente, fournir ses sous-titres accessibles.
- Vérifier le téléchargement des médias sous `/novaguard/`, le rendu mobile et le fonctionnement sans JavaScript.

Ce brief prépare l’intégration ; il ne signifie pas que les médias manquants sont produits ou intégrés.
