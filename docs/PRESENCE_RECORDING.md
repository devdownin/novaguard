# Validation de la capture des présences

Le réglage **Durée après détection = 0 s** active le backend tamponné Android. Les autres durées conservent le backend VisionCamera avec post-roll. Les préférences sauvegardées ne sont pas remplacées à la mise à jour.

Le tampon contient des échantillons H.264/AAC en mémoire ; aucun fichier de scène vide n'est produit. La confirmation sélectionne rétroactivement les images à partir de la première observation de la piste. Un retour après absence commence une nouvelle fenêtre, même si le tracker conserve l'identifiant. Seules les observations positives étendent cette fenêtre. Une panne d'analyse la ferme à la dernière observation connue.

Une présence terminée libère immédiatement la sélection suivante, même si son fichier reste en finalisation. Les clips partiels d’une erreur sont conservés lorsque le muxer peut les finaliser. Les noms sont réservés et renommés en série pour éviter les collisions entre passages d’une même seconde.

Chaque MP4 a un identifiant d'enregistrement et ses propres métadonnées. La rotation change de muxer sur la prochaine image indépendante, avec une marque de fin au même horodatage que le début du fichier suivant. L'encodeur continue. Les callbacks de fichiers précédents ne pilotent pas le fichier actif. L'écriture et la finalisation tournent sur un thread distinct de l'encodage.

Limites mémoire : tampon compressé de quatre secondes et 16 Mio, au plus huit images YUV en attente, bornées ensemble à 32 Mio et 32 Mio d'échantillons en attente d'écriture, en plus des buffers des codecs. Un dépassement est signalé. La résolution et la cadence effectives restent celles des images livrées par CameraX au frame processor ; l'inférence peut réduire cette cadence. Le codec doit produire des images indépendantes ; une incompatibilité est affichée, jamais masquée par un changement de mode.

Un fragment très court peut être conservé sans audio s’il ne contient aucun paquet AAC complet ; la vidéo ne dépend pas de cette disponibilité.

La borne d'entrée est la première observation reconnue et la borne de sortie la dernière observation positive, avec une dernière image de durée nominale 1/30 s. Entre observations, la présence réelle reste inconnue. Cela ne constitue pas une garantie de reconnaissance de tous les passages ni de toutes les espèces.

## Vérifications automatisées

- `npm run typecheck`, `npm run lint`, `npm test -- --runInBand`.
- `scripts/test-presence-native.sh` : politique Java réellement utilisée par le module ; entrée/sortie, observation tardive et partition des échantillons aux frontières.
- `cd android && ./gradlew assembleDebug` : compilation et assemblage Android.
- Les tests React du mode strict simulent uniquement le pont natif ; ils ne valident pas les codecs d'un téléphone.

## Essais sur appareil avant mise en production

Placer une horloge visible dans le champ et garder les fichiers originaux pour comparer les horodatages. Tester en 720p et 1080p, puis en 4K si l'appareil le supporte, avec microphone autorisé puis refusé.

| Scénario | Résultat attendu |
|---|---|
| Scène vide pendant cinq minutes | Aucun MP4 ni événement inventé |
| Personne seule puis départ | Première observation récupérée avant confirmation ; aucun post-roll |
| Animal seul | Même politique temporelle |
| Deux sujets ; le premier sort | Le second maintient l'enregistrement |
| Personne et animal sur des bords opposés | Champ intégral conservé malgré le zoom de l'aperçu |
| Absence puis retour avant expiration de la piste | Deux fenêtres ; aucune image de l'absence conservée |
| Présence dépassant deux minutes | Frontières de fichiers identiques, sans arrêt d'encodeur ni image perdue à la rotation |
| Écran éteint et rallumé | Capture et sélection continuent ; clips lisibles avec audio autorisé |
| Caméra reprise par une autre app, rotation et changement de résolution | Interruption affichée ; reprise bornée dès que des images sont disponibles |
| Stockage presque plein ou lent | Erreur visible, fichiers finalisés précédemment conservés |
| Encodeur indisponible au démarrage puis libéré | Nouvelle tentative pendant la même présence |
| Vignette tardive et callback de clip ancien | Aucun changement du clip actif ; chaque vignette appartient à son fichier |

Mesurer le retard d'observation, la cadence réelle, les images aux raccords, la durée de la dernière image, la synchronisation audio et la consommation mémoire/température. Ces résultats matériels restent nécessaires : une compilation et des mocks ne prouvent pas la continuité sur téléphone.
