# Initialisation des modèles TFLite

`useDetectionModel` appelle `loadTensorflowModel` directement. Le hook fourni par `react-native-fast-tflite` 1.6.1 ne protège pas ses réponses asynchrones : un premier chargement peut écraser le modèle demandé ensuite.

Une séquence appartient à la source, au choix « Forcer CPU » et à la taille attendue par `CameraFeed` : 320 pour Lite0, 448 pour Lite2. Elle invalide ses résultats et ses timers au changement ou au démontage. Le modèle précédent est masqué dès le rendu du changement, avant l’exécution des effets.

Avant publication, le hook exige une seule entrée uint8 `[1, taille, taille, 3]` et quatre sorties float32. Les dimensions sont contrôlées contre la préparation de l’image, et non déduites du nom du fichier. Les modèles incompatibles sont signalés et ne sont pas utilisés pour l’inférence.

Sur Android, le GPU est essayé d’abord, sauf si le CPU est explicitement choisi ou si le GPU a déjà refusé **cette source**. Son échec lance immédiatement une tentative CPU. Un échec CPU maintient le diagnostic et déclenche deux reprises, après 1 puis 3 secondes : trois tentatives CPU au maximum par séquence. Chaque tentative expire après 20 secondes. Changer « Forcer CPU » crée une nouvelle séquence, même si le délégué effectif reste `default` après un refus GPU.

L’expiration et l’annulation sont logiques : l’API native n’expose pas d’interruption d’un chargement déjà lancé. Sa réponse tardive est consommée et ignorée ; cela ne garantit pas l’arrêt immédiat du travail natif. Une erreur d’inférence après chargement n’est pas traitée par ce mécanisme.

## Vérification

- `npm test -- --runInBand __tests__/tfliteInitialization.test.tsx` : vrai chargeur JavaScript distribué par la bibliothèque, résolution des assets et appels JSI simulés, promesses ordonnées explicitement ; réponses périmées, CPU/GPU, délais, reprises bornées, dimensions et démontage.
- `npm run typecheck`, `npm run lint`, suite Jest et bundle Android de production.
- Sur téléphone : démarrage à froid, chargement Lite0/Lite2, changement rapide de modèle, activation/désactivation CPU, refus GPU, arrêt et relancement. Vérifier le diagnostic, les métadonnées des tenseurs et les premières inférences en CPU puis GPU.

Les tests JavaScript ne valident pas la compatibilité du délégué avec le GPU de chaque appareil, les threads d’inférence ni l’installation des bindings JSI.
