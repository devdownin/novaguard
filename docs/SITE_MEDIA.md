# Médias réels pour le site NovaGuard

## Captures reçues et intégrées — point 1 terminé

L’utilisateur a fourni les trois écrans de l’application. Le 16 octobre 2026, les captures Historique et Réglages ont été remplacées par les nouvelles pièces jointes ; la capture Surveillance est conservée. Les JPEG d’origine sont conservés à l’identique : aucune retouche, aucun recadrage ni ajout d’un état de surveillance fictif. Chaque fichier mesure 575 × 1280 pixels. Le modèle de téléphone et la version de l’application ne sont pas précisés par les fichiers fournis.

| Source fournie | Fichier publié | État visible | Taille |
| --- | --- | --- | --- |
| `1000038182.jpg` | `site/assets/screens/surveillance.jpg` | Surveillance inactive, caméra en veille, zéro détection du jour | 34 964 octets |
| `1000038232.jpg` | `site/assets/screens/historique.jpg` | Un passage « Personne détectée » à 08:22, vignette marquée 0:05, graphique de la journée | 29 960 octets |
| `1000038231.jpg` | `site/assets/screens/reglages.jpg` | Bloc « Assistant IA (MCP) », serveur éteint et bouton « Voir les services MCP » | 51 595 octets |

Empreintes SHA-256 des fichiers d’origine et publiés, identiques :

```text
5a1ebe2a6edfc58c21bb62990c5805620a40373ac2affdf3c8f3d93abd0ec21b  surveillance.jpg
be8b411e38d20eccf3bf88c5bc533f59cd7aa2460f4187f4b60908fe27fa6076  historique.jpg
58f79c7975d87297819e5f57986272f1a63699aca568a4ec5cee37e19acf2491  reglages.jpg
```

La capture Surveillance remplace l’illustration du visuel principal. La galerie `#apercu` montre les trois fichiers entiers, avec des textes alternatifs et des légendes adaptés à leur contenu réel. Chaque capture est un lien vers le JPEG en taille réelle : aucun script n’est requis pour l’agrandir. Les captures de la galerie se chargent à la demande (`loading="lazy"`) ; la capture principale est prioritaire. Le total des trois sources est de 116 519 octets, et l’image Surveillance utilisée deux fois partage la même URL pour bénéficier du cache du navigateur.

L’historique présente un événement déclaré par l’application, avec une vignette marquée 0:05 ; la capture seule ne vérifie pas la lecture du fichier vidéo. L’écran Réglages montre le serveur MCP éteint, sans connexion d’agent. Aucun événement, résultat de lecture ou échange d’agent n’est ajouté aux captures.

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

## Intégration vidéo après réception — point 2 en attente

La vidéo du parcours n’a pas encore été fournie. Après réception des clips :

- Préserver les actions et résultats réellement montrés, sans inventer un passage enregistré ou une réponse de l’agent.
- Ajouter un lecteur HTML `video` avec commandes, `preload="none"`, image d’affiche issue du clip et transcription du contenu. Si une parole est présente, fournir ses sous-titres accessibles.
- Vérifier le chargement sous `/novaguard/`, le rendu mobile et le fonctionnement sans JavaScript.

Le brief ci-dessus prépare cette intégration ; il ne signifie pas que la vidéo manquante est produite ou intégrée.
