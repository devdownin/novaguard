# NovaGuard

Caméra de surveillance Android, locale et open source. React Native 0.81 /
React 19 / TypeScript. Rien ne quitte l'appareil sans un geste du propriétaire :
pas de compte, pas de télémétrie, aucune connexion sortante. Le code est commenté en anglais, l'interface est en français.

## Capture des présences : contrat actuel

Le défaut des nouvelles installations est `post: '0 s'`. Ce mode sélectionne les fenêtres de détection positive et utilise `PresenceFramePlugin` → `PresenceRecorderModule` → `PresenceWindow` → `useBufferedRecorder`. Le tampon H.264/AAC reste en mémoire, les muxers se succèdent sur des images indépendantes sans arrêter l’encodeur, et la finalisation des MP4 tourne sur un thread distinct. Le début remonte à la première observation avant confirmation ; la fin ne comprend ni la grâce du tracker ni un post-roll. Une image ratée par le détecteur ne ferme pourtant pas la fenêtre tant que le tracker garde une piste confirmée : fermer dessus découpait un passage en micro-vidéos. Les callbacks et les métadonnées appartiennent à un identifiant d’enregistrement.

Les valeurs `post: 1/2/3 s` étendent la fenêtre native jusqu’à la dernière observation positive + la marge, sans grâce du tracker. `tolerance` mémorise la durée choisie quand `post` revient à zéro ; l’interface propose deux modes explicites. Les anciennes valeurs `post: 5/10/30 s` conservent le backend VisionCamera, avec marge après départ et coupures d’encodeur. Les descriptions historiques de ces coupures plus bas concernent ce backend. Le zoom de capture décrit plus bas n’est plus appliqué : le mouvement est limité à l’aperçu et le capteur reste au zoom neutre pour préserver tout le champ.

Le viseur, le statut et la notification partagent `surveillanceStatus`. Les erreurs de capture et de détection ont des propriétaires séparés ; une récupération ne doit pas effacer une panne indépendante. Le watchdog utilise une horloge monotone et signale toute analyse arrêtée après un premier résultat.

Vérifier la politique native avec `scripts/test-presence-native.sh`, les transitions du mode strict avec `__tests__/strictPresence.test.tsx` et les deux backends avec la suite Jest. Construire un APK pour les modifications Kotlin. Aucun mock ne prouve la continuité des codecs : suivre `docs/PRESENCE_RECORDING.md` sur appareil avant mise en production.

## Commandes

```bash
npm ci                 # les tests et le typecheck en dépendent
npm run typecheck      # tsc --noEmit
npm run lint           # eslint (0 erreur, 0 avertissement)
npm test               # jest
npm run android        # build + déploiement sur un appareil ou un émulateur
```

`npm test`, `npm run typecheck` et `npm run lint` sont ce que la CI exécute. Un
quatrième garde-fou y valide les ressources XML Android (voir plus bas).

## Architecture

Le flux principal va de la caméra à l'historique :

```
CameraFeed (frame processor, worklet)
  → letterbox             réduit l'image sans la déformer dans l'entrée carrée
  → interpretDetections   décode les 4 tenseurs d'EfficientDet-Lite0 / -Lite2
  → detectionsInZone      écarte ce qui se tient hors de la zone surveillée
  → updateTracks          suivi IoU + prédiction : confirme sur N images, tolère une
                          occlusion, révise l'étiquette du sujet sur les regards suivants
  → reportDetections      ouvre/ferme une session, pilote l'enregistrement
  → useRecorder           VisionCamera, cap de durée, clip rendu par callback
  → videoStore            nommage, renommage sans écrasement, suppression
  → events                historique persisté dans AsyncStorage
```

- `src/state/AppStateContext.tsx` — l'état applicatif. Deux contextes : le
  principal, qui ne change qu'au rythme des actions utilisateur, et
  `ViewfinderCtx`, qui porte l'état par image et vit dans un composant enfant.
- `src/ml/`, `src/camera/framing.ts`, `src/recording/library.ts` — logique pure
  et testée. Les effets de bord vivent dans `videoStore.ts`.
- `src/specs/` — TurboModule (codegen). L'implémentation native est en Kotlin
  dans `android/app/src/main/java/com/novaguard/surveillance/`.

## Ce qui casse ici, et pourquoi

Ces pièges ont tous déjà coûté un bug en production. Ils justifient des choix
qui, sans ça, paraissent tordus.

**La liste des caméras peut rester vide pour toujours.** VisionCamera 4.7 la lit dans `getConstants()` et la renvoie à `initialize()`, deux moments qui, en nouvelle architecture, précèdent la fin de l'initialisation asynchrone de CameraX — et rien ne la renvoie ensuite. `useCameraDevice` rendait donc `undefined` à jamais et le viseur disait « aucune caméra » sur un téléphone qui en a trois. `useCameraDeviceRecovery` demande à `CameraDevicesManager.sendAvailableDevicesChangedEvent()` (public, idempotent) de réémettre la liste chaque seconde tant qu'aucune caméra n'est connue. À retirer le jour où la bibliothèque émet elle-même la liste une fois CameraX prêt.

**La caméra ne nous appartient pas.** Un appel entrant, une autre application,
une politique constructeur : CameraX rend l'erreur et cesse de livrer. Comme
l'écran d'un téléphone de surveillance est éteint, l'interruption doit être dite
sur la notification du service — la seule surface visible — retentée jusqu'à ce
qu'elle cesse, et déclarée finie **sur une image reçue**, jamais sur un
redémarrage : une session qui se monte et ne livre rien est la panne elle-même.
`cameraHealth.ts` porte cette décision ; `onError` de `<Camera>` va à
`reportCameraError`, distinct de `reportCameraProblem` qui porte aussi le modèle
qui ne charge pas et les erreurs de frame processor, lesquelles ne tuent pas la
session.

**Le chemin chaud est le frame processor.** `reportDetections` est appelé
jusqu'à 5 fois par seconde. Son identité alimente la liste de dépendances du
worklet : la faire changer reconstruit le worklet. Tout réglage qu'elle lit
passe donc par une ref (`useLatest`), jamais par une dépendance. Un nouvel état
qui change à cette cadence va dans `ViewfinderProvider`, pas dans le fournisseur
principal — sinon tout l'arbre se redessine à 5 Hz.

**Ce qui entre dans un worklet est recopié, pas partagé.** Le compilateur
worklets détache la fonction de sa portée et met les variables libres qu'elle
lit dans un `__closure` transmis par valeur à un second runtime. Une fonction JS
ordinaire y devient un talon qui lève à l'appel ; un `Set` ou une `Map` n'y
arrive pas du tout — voyant `X.has(...)`, le compilateur ne remonte que
`{ has: Set.prototype.has }`, une primitive sur un objet nu. Les deux ont tué
l'application sur la première image. Donc : toute fonction appelée depuis le
frame processor porte `'worklet'`, et on n'y capture que des données simples
(tableaux, objets, nombres) lues en accès *calculé*. `npm test` ne voit rien de
tout ça — `babel.config.js` coupe le plugin sous Jest — d'où
`__tests__/workletSafety.test.ts`, qui compile pour de vrai et inspecte les
closures.

**Une erreur dans le frame processor tue le processus.** VisionCamera la
rattrape sur le thread worklet et la repasse à `reportFatalError` : en release,
une seule mauvaise image ferme l'application. Le corps de l'analyse est donc
sous `try`, et `frameErrorGuard` rattrape le reste — mais seulement ce qui porte
la marque de VisionCamera. Élargir ce filtre transformerait chaque vrai plantage
en application vivante et inerte, ce qui est pire.

**`runAsync` a tué cette application.** Il déplace l'analyse dans un second
contexte worklet et maintient l'image vivante d'un thread à l'autre : SIGSEGV
sur `VisionCamera.video` quelques images après l'apparition de l'aperçu, puis un
`ImageReader` à court de tampons parce que les images retenues n'étaient jamais
refermées (même panne ouverte en amont,
mrousavy/react-native-vision-camera#2589, builds release uniquement). L'analyse
tourne donc sur le thread qui livre l'image. Elle le bloque, et c'est voulu :
`runAtTargetFps` et la contre-pression de CameraX écartent déjà les images qu'on
ne regarde pas, l'aperçu a son propre flux. `__tests__/workletSafety.test.ts`
vérifie que `runAsync` n'est pas réintroduit.

**Ce qui plante sous le JavaScript ne laisse rien.** Un segfault dans libyuv,
LiteRT ou ML Kit termine le processus avant le `try` comme avant le garde : pas
de message, pas de log que l'utilisateur puisse lire. `frameTrace.ts` note donc
l'appel que l'analyse *s'apprête* à faire — `camera`, `resize`, `inference`,
`faces` — avant de le faire, et le lancement suivant nomme celui qui n'a jamais
rendu la main. L'ordre est tout le principe : enregistrer un succès nommerait la
dernière chose qui a marché, c'est-à-dire tout sauf le coupable. Les sauts
d'étape dans le worklet sont inconditionnels, et doivent le rester : un drapeau
serait soit une valeur capturée, figée à la compilation, soit une valeur
partagée dont le compilateur recopie le `.value` — les deux arrêteraient la
trace en silence. C'est le côté JS qui cesse d'écrire, dès qu'une image passe
entière.

**Entre deux clips, personne n'est filmé.** La durée maximale coupe un fichier
sans couper le passage : la session survit, et le clip suivant s'ouvre dès que
l'encodeur rend la caméra. VisionCamera n'offre pas de segmentation sans
couture, donc ce trou — la finalisation du fichier — ne peut pas être supprimé.
Il peut en revanche être élargi par accident, et il l'était : la taille du clip
était relue sur disque *avant* de rouvrir, ajoutant un aller-retour par le pont
natif à une fenêtre où rien n'est enregistré. D'où `onEncoderFree`, annoncé dans
`onRecordingFinished` avant le `stat()`, distinct de `onClip` qui a besoin du
compte d'octets. Tout ce qu'on ajoute entre la fin d'un clip et le début du
suivant se paie en images perdues. L'application se mesure donc elle-même
(`clipGap.ts`, affiché dans Setup → À propos) : seul un appareil peut répondre,
un faux timer ne dit rien d'un encodeur. Les deux moitiés sont rapportées
séparément parce qu'elles n'appellent pas le même travail — la finalisation
appartient à VisionCamera, la relance est à nous. Ni l'une ni l'autre borne
n'est l'instant où le capteur cesse ou reprend de livrer des images, que rien
en JS ne peut voir : la somme encadre cette fenêtre, elle ne l'égale pas, et
c'est ainsi qu'elle est présentée.

**Le garde-fou d'espace disque doit tourner à chaque clip, pas à chaque
session.** Il ne s'exécutait qu'à l'ouverture d'une session, ce qui suffisait
tant qu'une coupure de durée maximale détruisait la session — l'image suivante
repassait par là. Faire survivre la session à la coupure a donc silencieusement
retiré le contrôle des passages longs, c'est-à-dire précisément des
enregistrements capables de remplir un disque. `hasRoomToRecord` est appelé aux
deux endroits, et les seuils ne sont plus des constantes plates : 150 Mo
laissaient démarrer un clip de 2,2 Go (15 min en 4K). `minFreeBytes` et
`lowSpaceBytes` dérivent de `qualityBitRate × maxDurationMs`, et
l'auto-suppression ne récupère jamais jusqu'à une marque qui refuserait encore
d'enregistrer — supprimer l'historique *et* rester incapable de filmer est le
pire des deux.

**Le zoom cadre une personne entière, jamais un visage seul.** Il a été
construit sur la boîte du visage, et c'est ce qui le rendait inutile : à 2,8×
sur une tête, les mains, ce qu'elles portent et la direction prise sortent du
cadre — et du fichier — alors que c'est exactement ce qu'une caméra de
surveillance est là pour garder. Le sujet est donc `subjectBox`, qui rend
toujours une boîte **de personne**. La détection de visages n'a pas disparu
mais ne cadre plus rien : elle choisit *qui* regarder quand plusieurs personnes
sont dans le champ, et son union avec la personne rattrape une boîte qui aurait
coupé la tête. Deux conséquences qui ne doivent pas être reperdues : un sujet
sans visage détecté — de dos, masqué, dans le noir — déclenche le mouvement
comme les autres, et un visage sans personne n'en déclenche aucun. Cadrer un
corps borne aussi le grossissement tout seul, `computeFraming` s'arrêtant à la
couverture demandée : quelqu'un qui remplit l'image est à peine rapproché,
quelqu'un au fond d'une pièce est amené devant.

**Un transform React Native ne touche pas l'enregistrement.** Le zoom
cinématique a longtemps été un `transform` sur la vue qui contient l'aperçu :
l'encodeur est en aval de la session de capture, pas de l'arbre de vues, donc le
fichier restait large. Seul `<Camera zoom>` atteint le fichier — et c'est un
recadrage **centré, sans panoramique**. Appliquer telle quelle l'échelle du
mouvement recadrerait hors du sujet dès qu'il n'est pas au centre : sur une
caméra de surveillance, c'est perdre la preuve. D'où `maxZoomKeepingInFrame`,
qui borne le zoom de capture par la position du sujet lui-même ; le reliquat
reste au transform, qui sait panoramiquer. Les deux changent dans le même
commit et leur produit est inchangé, donc l'écran ne bouge pas —
`boxInZoomedFrame` est ce qui empêche les deux grossissements de se multiplier.
**Un zoom de capture n'est pas un mouvement, mais le tracker ne sait pas
faire la différence.** Toutes ses boîtes sont exprimées dans un cadre qui vient
d'être recadré, donc le même sujet arrive ailleurs à l'image suivante ;
au-delà d'un certain pas, `updateTracks` cesse de le reconnaître, abandonne la
piste, et la remplaçante demande `confirmAfter` images avant d'être confirmée —
sans sujet confirmé pendant ce temps, et le post-roll qui s'arme. **Un plafond
fixe ne corrige pas ça** : une boîte centrée ne fait que grandir et garde
`1/z²` d'elle-même (2× est sa limite), mais une boîte décentrée est *translatée*
bien plus qu'elle ne grandit et peut ne plus recouvrir sa position d'avant dès
1,5×. La borne doit donc être celle du sujet lui-même — `maxZoomTrackable`,
mesurée avec l'`iou` **du tracker**, sur la boîte **brute** qu'il compare et non
sur la boîte paddée du cadrage. `captureZoomFor` réunit les quatre bornes en un
seul endroit exprès : quatre bornes qui interagissent, et un balayage qui
recalculerait la décision au lieu de l'appeler continuerait de passer après
qu'elle a changé — ce qui est arrivé à la première version de ce test.

**Ce que le zoom de capture recadre, le modèle ne le voit plus non plus.**
CameraX applique la *crop region* à tout le groupe de cas d'usage : à `z`, il
ne reste que `1/z²` de la surface du capteur, et ce qui tombe ne va ni dans le
fichier ni au détecteur. Les bornes du sujet ne disent rien de ça — un sujet
petit et bien centré laissait monter à 1,77×, soit deux tiers de la pièce
disparus pendant toute la tenue du plan serré, et quelqu'un entrant par le côté
n'était ni filmé ni vu. D'où `CAPTURE_ZOOM_CEILING = 1,41` (√2 : la moitié de
la surface conservée). Le grossissement refusé n'est pas perdu, il reste au
transform de l'aperçu, qui sait panoramiquer : seul l'enregistrement renonce au
détail supplémentaire, ce qui est le bon sens de l'échange pour une caméra dont
le métier est de ne rien manquer.

**ML Kit n'est appelé que quand sa réponse peut changer quelque chose.** Depuis
que le zoom cadre des personnes entières, un visage ne décide plus de la
distance mais de *qui* suivre — avec une seule personne à l'image, il n'y a rien
à décider. L'appel natif est donc gardé derrière « au moins deux personnes »,
ce qui l'élimine dans le cas de très loin le plus fréquent. Le prix est l'union
qui rattrape une tête coupée par la boîte de détection quand le sujet est seul ;
le cadrage padde de toute façon, donc c'est un plan un peu plus serré, pas un
plan sans tête.

Et la main n'est passée au capteur **qu'à l'arrivée** du mouvement : `zoom` est
une propriété de session native, ce projet n'a pas Reanimated, et l'animer
voudrait dire une mise à jour de prop par image affichée dans une application
bâtie pour ne pas re-rendre le viseur. L'enregistrement reçoit donc le gros plan
d'un coup, pas en fondu.

**La surveillance tourne écran éteint ; le reste ne doit pas.** C'est tout
l'objet du service de premier plan : caméra, analyse, suivi et enregistrement
continuent en arrière-plan. Ce qui continuait avec eux, c'était le travail dont
le seul produit est à l'écran — le flux d'aperçu, et l'état du viseur que le
chemin d'image poussait jusqu'à cinq fois par seconde pour déplacer une boîte
sur un écran éteint. `useForeground` sépare les deux, et `preview={foreground}`
est la seule prop touchée : **`isActive` reste vrai**, sinon on arrêterait la
surveillance au lieu d'économiser. La bascule ne suit que le passage en
arrière-plan, jamais le début ou la fin d'un enregistrement — ajouter ou retirer
une sortie d'aperçu en plein clip reconfigure la session de capture, et ce
dépôt a déjà payé une reconfiguration de ce genre entre deux clips. Enfin
`AppState.currentState` vaut `undefined` avant le premier évènement et peut
valoir `unknown` sur appareil : seul un `background` explicite compte comme
caché, parce que se tromper dans l'autre sens éteint l'aperçu d'une application
qu'on est en train de regarder.

**Une rotation ne remonte rien.** L'activité déclare `orientation|screenSize`
dans ses `configChanges` : Android ne recrée pas l'application quand le
téléphone est tourné, donc une dimension lue une fois — `Dimensions.get` au
premier rendu — reste celle du lancement pour toujours. L'orientation se lit
par `useLandscape` (au-dessus de `useWindowDimensions`), et chaque composant la
lit pour lui-même : le shell, le rail de navigation et l'écran affiché sont
trois abonnés distincts du même évènement. Deux conséquences à ne pas reperdre :
`numColumns` d'une `FlatList` ne peut pas changer sans changer aussi sa `key`
(RN lève un invariant), et une valeur d'animation initialisée avec la hauteur de
la fenêtre doit être **réarmée à l'ouverture**, pas à la construction du
composant. `__tests__/landscape.test.tsx` tourne un vrai `<App />` dans une
fenêtre couchée et le fait pivoter en cours de route, parce que c'est le seul
scénario où les trois abonnés répondent en même temps.

**L'interface est traduite ; les identifiants ne le sont pas.** `src/i18n`
porte deux catalogues, `fr.ts` (la source) et `en.ts` (typé
`Record<StringKey, string>`, donc une clé oubliée ne compile pas). La langue est
lue une fois, depuis `I18nManager` : `locale` n'est pas dans les `configChanges`
de l'activité, donc Android recrée le processus quand elle change — un abonnement
ne se déclencherait jamais. Trois choses ne doivent pas être reperdues : les
unions de `state/types.ts` (`'Personne'`, `'Basse'`, `'7 jours'`) sont des
identifiants **écrits sur disque et comparés par le tracker**, jamais traduits —
seul leur affichage l'est, par `tValue`, dont la clé est vérifiée à la
compilation ; le séparateur décimal et les unités Ko/Mo/Go font partie du
catalogue, parce que « 1,5 Go » et « 1.5 GB » ne sont pas le même nombre pour
leurs lecteurs ; et les trois préfixes d'erreur (`error.prefix.*`) sont ceux sur
lesquels `CAMERA_OWNED_ERROR` filtre pour décider quelles bannières le chemin
caméra a le droit d'effacer — traduire un message sans son préfixe laisse une
erreur figée dans le viseur, en silence. `__tests__/i18n.test.ts` tient les
placeholders, les traductions oubliées et cet accord préfixe/message ; la suite
tourne sur un appareil français (`testing/frenchDevice.js`), fixé comme
`jest.config` fixe déjà le fuseau et par le même chemin que sur un vrai appareil.

**Un contrôle sans rôle n'existe pas pour un lecteur d'écran.** Il est annoncé
comme du texte, donc le geste « contrôle suivant » ne l'atteint jamais — le
bouton principal de l'application était dans ce cas. Un libellé qui ne tient pas
debout seul (« Autoriser » trois fois, « 7 jours » sans son réglage) en demande
un explicite. Et la taille de texte se **plafonne** (`MAX_FONT_SCALE`) là où une
ligne est partagée, jamais ne s'interdit : `allowFontScaling={false}` est
l'anti-patron, et `__tests__/accessibility.test.tsx` vérifie qu'il n'est nulle
part — en inspectant les nœuds **hôtes** porteurs d'un responder, c'est-à-dire ce
qu'Android donne réellement à TalkBack, et pas les composants qui reçoivent une
prop `onPress`.

**Le seuil de confiance est une porte d'entrée, pas un filtre.** Il a été les
deux, et le prix était que toute boîte sous la barre n'existait pour personne :
EfficientDet-Lite0 en 320 px note un sujet lointain, de dos ou dans l'ombre entre
0,4 et 0,6 et oscille autour de n'importe quelle ligne tracée là-dedans, donc un
seul seuil manque ces passages ou enregistre le bruit. Les deux rôles sont
séparés : `floorConfidence` (`interpretDetections`, constante basse) décide ce
qui est **associé**, `startConfidence` (`tracker.ts`, le réglage utilisateur)
décide ce qui peut **ouvrir** une piste. Une piste ouverte survit donc aux
regards faibles. Il y a deux portes, une par genre (`animalThreshold`, `animalStartConfidence`) : un chat lointain est noté bien en dessous d'une personne à la même distance, quand ombres et vêtements pliés se lisent en chiens. Et une boîte plus petite que `minStartSide` n'ouvre rien — ce sont quelques pixels dans l'entrée du modèle — mais une piste ouverte la suit jusqu'à `MIN_BOX_SIDE`. Conséquence à ne pas reperdre : le réglage n'atteint plus le
worklet, il est lu par `reportDetections` — à travers `settingsRef`, comme tout
le reste sur ce chemin — ce qui est aussi ce qui le rend enfin testable
(`settingsWiring.test.tsx`), le worklet étant hors de portée sous Jest.

**Le recouvrement seul ne suit personne.** À 3 i/s, quelqu'un qui traverse le
champ se déplace de plus que sa propre largeur entre deux regards : `iou` vaut 0,
la piste est abandonnée, et sa remplaçante demande `confirmAfter` regards pendant
lesquels le sujet bouge encore. À « Basse » (1 i/s) c'était tout passage qui n'est
pas quelqu'un d'immobile. D'où une vitesse lissée par piste, une association
contre la position **prédite**, et un repli par distance des centres quand les
boîtes ne se touchent plus — borné par `maxTravel` et par un rapport de tailles,
sinon deux personnes qui se croisent échangent leurs pistes. Le score composite
(`1 + iou` contre `1 - distance/portée`) garantit qu'un vrai recouvrement gagne
toujours la passe gourmande. **La prédiction ne sert qu'à l'association** : la
boîte affichée et celle qui cadre reste la dernière *vue*, sinon l'application
dessine quelqu'un là où il n'y a personne.

**Le modèle n'est pas invariant à l'étirement.** L'image entière était mise à
l'échelle en 320×320 sans conserver ses proportions, donc un cadre 16:9 arrivait
écrasé et une personne debout faisait 1,78× sa largeur relative. Invisible — les
boîtes restent des boîtes — et coûteux exactement sur les sujets déjà limites.
`letterbox.ts` réduit uniformément et pose l'image dans un coin, le reste à zéro
(la préprocessing d'EfficientDet elle-même), et `scaleX`/`scaleY` remettent les
boîtes à l'échelle du cadre. Deux pièges : le plugin **redimensionne avant de
tourner**, donc la taille demandée est dans les axes du tampon, échangés quand
`swapsAxes` ; et le tampon d'entrée est alloué par image analysée, parce qu'un
tampon gardé au niveau module serait recopié dans le runtime worklet à chaque
appel — donc réalloué de toute façon, plus une copie.

**La suppression des doublons du modèle est par classe.** Une silhouette
accroupie ou lointaine ressort à la fois en `person` et en `dog`/`bear`, et
chaque doublon serait sa propre piste, sa propre notification et sa propre ligne
d'historique. `interpretDetections` réduit donc deux hypothèses de genres
différents qui se recouvrent à plus de 60 % à la plus sûre — en parcourant à
l'envers une liste déjà triée par confiance, ce qui est ce qui garantit que le
survivant est la meilleure. Son `overlapOf` est une copie délibérée de l'`iou` du
tracker : celui-ci est du JavaScript ordinaire, et une fonction ordinaire
atteinte depuis un worklet est un talon qui lève.

**Une zone de détection peut éteindre l'application en silence.** C'est le seul
filtre qui coupe les faux positifs qu'aucun seuil n'atteint — un téléphone sur
un rebord de fenêtre voit la rue et le trottoir autant que le jardin, et chaque
passant est une détection *correcte* de quelqu'un que personne n'a demandé. Mais
elle est stockée, invisible une fois la surveillance lancée, et une zone qui ne
laisse rien passer ressemble exactement à une pièce vide. Trois choses en
découlent. `MIN_ZONE_SIDE` refuse une zone qu'un appui parasite aurait pu
dessiner. Le test porte sur le **point bas** de la boîte (les pieds), pas sur
son centre ni sur son contenu entier : quelqu'un sur le trottoir penché
au-dessus de la clôture a la tête et les épaules dans la zone, il est quand même
sur le trottoir. Et la zone est stockée en espace-cadre, jamais en espace-vue :
ce qui a été tracé l'a été sur un viseur d'une certaine taille, et un téléphone
tourné en a un autre — `viewBoxToUprightBox` convertit une fois, à l'entrée.

**Une zone ignorée ne doit cacher personne.** Les zones ignorées (`exclusions`, `MAX_EXCLUSIONS = 3`) coupent ce que la zone ne peut pas couper : une télé, une fenêtre sur le voisin, un rideau, *dans* la pièce surveillée. Elles sont jugées sur le **même point bas** que la zone, et c'est ce qui les rend sûres : ce que le modèle lit sur un écran a sa boîte, donc son bas, sur l'écran ; quelqu'un qui passe devant a les pieds au sol, en dessous. Tester le recouvrement de la boîte ferait disparaître exactement cette personne-là. Elles s'ajoutent à la zone sans la remplacer, se tracent avec le même éditeur (`zoneEditKind`), ne changent pas le recadrage de l'analyse, et le dernier rectangle tracé ne revient jamais armé à l'ouverture suivante de l'éditeur.

**Une zone réduit aussi ce que le modèle regarde.** Avec une zone, seul son voisinage est passé au détecteur (`analysisCrop.ts`) : la zone, une marge latérale et de la place au-dessus pour le corps dont les pieds y sont — le test de zone porte sur le point bas, donc rien de ce qui compte n'est coupé. Le gain est la résolution sur la cible, à calcul constant. Deux pièges : le plugin **recadre avant de tourner**, donc le rectangle choisi en espace redressé passe par `cropInBuffer`, et `interpretDetections` remet les boîtes en fractions du cadre entier (`cropX…`). Pendant l'édition d'une zone, l'image entière est analysée.

**Ce qui ne bouge jamais n'est pas un visiteur.** Un manteau sur une patère est lu comme une personne à chaque regard, avec un score stable : rien dans la confiance ne le distingue. Chaque piste porte donc l'`anchor` où elle se tient ; au-delà de `SCENERY_AFTER_MS` sans le quitter (`STILL_IOU`), elle est du décor (`scenery.ts`) : elle n'ouvre ni ne prolonge une session et n'est pas dessinée, mais reste suivie — le premier vrai mouvement en refait un sujet. Le décor est mémorisé par emplacement (`SCENERY_FORGET_MS`), sinon chaque piste perdue puis recréée au même endroit refilmait trois minutes. Le prix assumé : quelqu'un de réellement immobile pendant trois minutes.

**Une image sombre est éclaircie pour le modèle, jamais pour le fichier.** `liftShadows` (`lowLight.ts`) applique une courbe gamma à l'entrée du modèle quand sa luminance moyenne passe sous `DARK_MEAN`, et rien sous `MIN_MEAN` : amplifier du bruit en formes, c'est une pièce noire qui se met à filmer.

**Une caméra masquée ressemble à une pièce vide.** Rien n'est détecté dans les deux cas, et c'est précisément ce que l'application affiche quand tout va bien. `tamper.ts` lit l'échantillon de scène que l'analyse prend **avant** l'éclaircissement (`sceneSample` : luminance moyenne et grille 8×8) : noir sous `MIN_MEAN` pendant 5 s, c'est « Image noire » — une pièce éteinte est le même angle mort, et nommée comme tel ; une grille qui cesse d'être corrélée à la référence pendant 8 s **sans piste confirmée**, c'est « Champ de vue modifié ». Corrélation et non différence, et référence qui dérive lentement, pour que le crépuscule ne compte pas ; personne suivi, parce qu'un visiteur change la scène en étant là. Le changement est verrouillé jusqu'à « C'est voulu » ou une relance : un téléphone tourné l'est encore après l'alerte. Les deux ont leur propre propriétaire, comme capture et détection, et aucun « Réessayer » : la caméra marche, elle ne voit rien.

**Dessiner la zone fait tourner la caméra sans que ce soit de la surveillance.**
L'éditeur a besoin de l'image à laquelle la zone s'applique, donc `active` vaut
aussi vrai pour lui. Deux gardes vont avec, et aucune n'est optionnelle :
`reportDetections` sort avant de suivre quoi que ce soit — sinon une session
s'ouvrirait, et un enregistrement avec, derrière un écran dont les boutons
disent « Annuler » — mais **après** avoir posé `frameAspect`, que l'éditeur
utilise pour convertir et que seule une image analysée peut apprendre. Et
l'auto-zoom est coupé pendant l'édition : sur un aperçu transformé, ce que le
doigt trace n'est pas là où le détecteur regarde.

**Deux modèles, un seul labelmap.** « Détection étendue » charge
EfficientDet-Lite2 (448 px) au lieu de Lite0 (320 px) : nettement meilleur sur
les sujets lointains — ce qui, sur une caméra de surveillance, est la plupart
d'entre eux — pour environ trois fois le calcul, d'où un réglage et non un
remplacement. Les deux viennent du même miroir TensorFlow et portent le **même**
labelmap de 90 entrées, octet pour octet ; c'est la seule condition pour que
`labels.ts` reste valide, et celle dont la violation tue la détection en silence
(un `???` en tête décale toutes les classes d'un cran). Seule la taille d'entrée
change, et elle est passée au worklet comme une valeur capturée.

**« Sensibilité » règle trois choses qui s'échangent.** Elle n'en réglait qu'une
— la cadence — et les deux extrémités de l'échelle disaient alors autre chose que
ce qu'elles annoncent : à « Basse », 1 i/s avec `confirmAfter: 2` veut dire une
seconde entière avant le moindre enregistrement, donc le début de chaque passage
perdu ; à « Haute », les images supplémentaires n'achetaient que de la batterie,
puisque ce qu'on acceptait de chacune ne changeait pas. Corroborer sur le regard
suivant coûte 200 ms à 5 i/s et une seconde à 1 i/s : à « Basse » cette
corroboration est donc abandonnée, et **payée** par un score plus élevé. Lâcher
les deux ferait d'une seule mauvaise image un enregistrement. Le tout vit dans
`sensitivity.ts` plutôt qu'éparpillé entre `CameraFeed` et `reportDetections`,
pour la même raison que `captureZoomFor` : un test qui recalculerait l'échange
au lieu de l'appeler continuerait de passer après qu'il a changé.

**L'auto-réglage ne rend jamais que ce qu'il a pris.** La cadence mesurée
(`frameRate.ts`) n'était qu'un affichage : un appareil qui n'analyse qu'une image
par seconde là où « Sensibilité » en demande cinq manquait des passages en le
disant dans un coin du viseur. `autoTune.ts` agit dessus, et trois règles le
tiennent — aucune n'est décorative. Il ne fait que **retirer** ce que
l'utilisateur avait demandé, jamais accorder ce qu'il a laissé éteint, et
`tunedSettings` est le seul endroit où la fusion se fait : `settings` reste le
choix de l'utilisateur, n'est pas réécrit sur le disque, et une caméra de
surveillance qui rallume discrètement ce que son propriétaire a refusé est pire
qu'une caméra lente. L'échelle commence par le zoom automatique et finit par la
détection étendue, parce que le premier cadre un sujet quand le second décide
s'il existe. Et un palier qui n'a rien acheté est repris puis blacklisté :
throttling thermique, format 4K, téléphone occupé — rien de tout ça n'est sur
l'échelle, et sans cette vérification l'application se démonterait contre un mur.
L'hystérésis est volontairement asymétrique (3 fenêtres pour retirer, 15 pour
rendre) parce que restaurer reconstruit le frame processor et recharge un modèle.
L'échelle a trois barreaux, et le deuxième descend « Sensibilité » d'un cran
plutôt que de plafonner les images par seconde : le réglage bouge trois choses
ensemble (`sensitivity.ts`), donc une cadence baissée toute seule continuerait
d'exiger une corroboration qu'elle ne peut plus payer. C'est aussi pourquoi la
vérification se juge sur la **fraction de la cible atteinte** et non en i/s :
2,5 i/s sur 5 est un échec, les mêmes 2,5 sur 3 non, et lu en i/s le palier de
sensibilité serait rendu aussitôt pris.

Le verdict meurt avec la session, mais le **point de départ** lui survit
(`@novaguard:autotune:v1`, une entrée par qualité d'enregistrement) : un
téléphone qui ne tenait pas la 4K hier ne repaie pas six secondes de détection
dégradée pour le réapprendre. Ce qui est restauré, ce sont les paliers, jamais
les échecs ni les preuves — la boucle les rend tous dès une série de fenêtres à
pleine cadence. Rien de tout ça n'est un réglage utilisateur : c'est la lecture
que l'application fait de l'appareil, et elle n'écrit jamais dans `settings`.

Et depuis que `thermalStatus()` existe, la boucle voit la **cause** et plus
seulement le symptôme. Un téléphone bridé par la chaleur est plus lent que
lui-même : on agit plus tôt (une fenêtre au lieu de trois) et on ne blackliste
pas un palier que la chaleur a fait échouer. Un téléphone simplement trop lent
ne changera pas : là, un palier sans effet est définitivement écarté. Le
silence — la majorité du parc — n'est ni l'un ni l'autre, et surtout pas de la
chaleur. La batterie est mesurée et affichée, jamais utilisée pour décider :
baisser la détection parce qu'une charge est basse est un arbitrage qui
appartient au propriétaire de la caméra.
`autoTuneLog.ts` garde la série sous ce verdict — bornée, mutée en place, jamais
rendue directement : une fenêtre y tombe toutes les deux secondes sur le chemin
d'image, donc l'écran qui la dessine (`AutoTuneSheet`) relit le tampon tant qu'il
est ouvert au lieu que le provider publie. Chaque échantillon porte un état **par**
palier, pas un drapeau : « actif », « retiré par l'app » et « éteint par vous » sont
trois choses différentes, et un graphique qui les confond fait porter à
l'application un retrait qu'elle n'a pas fait.

**Une nouvelle référence de tableau est un re-rendu.** `confirmedTracksIfChanged`
existe pour ça : conserver l'identité quand l'incrustation ne changerait pas.

**Il y a exactement une porte de sortie, et elle demande un geste.** Les clips
sont écrits dans le répertoire privé de l'application : aucune autre app ne
peut les lire, rien ne part tout seul, et c'est ce qui donne son sens au
« traitement 100 % local ». Mais une vidéo qu'on ne peut jamais remettre à une
assurance ou à la police n'est pas une preuve non plus. `ClipSharing` passe donc
par un `FileProvider` — une URI de contenu par fichier, une autorisation de
lecture temporaire qui meurt avec l'activité qui la reçoit — et jamais par un
chemin `file://`, qu'Android refuse d'une app à l'autre depuis l'API 24. La
racine déclarée dans `res/xml/file_paths.xml` est exactement le dossier des
enregistrements : l'élargir ferait la différence entre partager un clip et
exposer tout le stockage privé de l'application. L'export d'un passage passe par la même porte :
les clips et un rapport dont les empreintes SHA-256 sont calculées sur
l'appareil, **hors du thread JS** (un passage 4K, c'est des centaines de Mo à
lire). Le rapport doit être servi par le même `FileProvider`, donc il est écrit
sous `recordings/exports/` — un sous-dossier que le balayage des orphelins ne
voit pas, puisqu'il ne lit que les fichiers à la racine de `recordings/`. Le
déplacer à la racine le ferait effacer au lancement suivant, comme un clip
sans évènement.

**Une vignette qui existe aussi écran éteint.** `takeSnapshot` capture la vue
d'aperçu — c'est ce qui lui permet de ne toucher ni l'encodeur ni la session de
capture, et c'est le bon compromis. Son prix est écrit à côté de l'appel : il
n'y a pas d'aperçu à capturer écran éteint, ce qui est l'essentiel de la vie
d'un téléphone de surveillance. L'historique redevenait donc des lignes
identiques précisément pour les passages que personne n'a vus en direct — ceux
pour lesquels il existe. Le repli lit le fichier : le clip est sur le disque à
ce moment-là, et un décodeur se moque de l'état de l'écran. Trois règles
tiennent le tout : il n'est demandé **que** si le snapshot est revenu vide (une
image par clip, pas deux) ; **après** le renommage, donc le JPEG porte le nom
final et `eventFiles` supprime la paire par nom ; et l'évènement ne l'attend
jamais — un décodage sans réponse ne doit pas coûter un enregistrement, la même
règle qu'`onClipAbandoned`.

**L'image de l'alerte suit l'alerte, elle ne la retarde pas.** La vignette de l'Historique n'existe qu'après le clip ; l'alerte part à l'ouverture de la session. L'image vient donc de `LiveStill` — le chemin de `get_live_frame`, qui marche écran éteint parce qu'il lit l'image de la caméra et non l'aperçu — et le frame processor lui offre des images dès que l'alerte avec image est possible (`stillsWanted`), ce qui ne coûte qu'une lecture de volatile tant que personne ne demande. Qui peut demander reste décidé ailleurs : le serveur refuse `get_live_frame` tant que `mcpLiveFrameEnabled` est éteint, quoi que reçoive le plugin. Côté notification, le texte est posté tout de suite et la même notification est reposée avec l'image, `setOnlyAlertOnce` sur ce seul repost — sur le premier, il ferait taire toute alerte suivante tant que la précédente est affichée. Un repost ne vise que l'alerte pour laquelle l'image a été prise (`serial`) et encore affichée : sinon une notification balayée reviendrait. Et `setLocalOnly(true)` : Android relaie sinon les notifications vers une montre, et ce que la caméra a vu ne quitte pas le téléphone.

**Les heures calmes retiennent l'alerte, rien d'autre.** `inQuietHours` compte en heures locales, début inclus, fin exclue, et une plage qui commence où elle finit est vide plutôt que toute la journée : faire taire toutes les alertes est le rôle de l'interrupteur principal, pas d'un curseur laissé deux fois sur la même heure. L'enregistrement et l'Historique ne la voient pas — le passage de la nuit doit être là le matin.

**Le splash ne ralentit pas le lancement, il le recouvre.** Il a été maintenu
1600 ms *à la place* de l'application, puis réduit à 250 ms pour cette raison :
`resumeOnLaunch` remet la caméra au travail à l'ouverture, donc chaque
milliseconde de splash était du temps où personne n'est filmé. À 250 ms, plus
personne ne le voyait. Il est donc dessiné **par-dessus** le shell dès
l'hydratation (`SplashOverlay`) : la caméra se monte et reprend dessous, et le
maintien (`SPLASH_HOLD_MS`, compté depuis le lancement) ne coûte plus aucune
image. Avant l'hydratation, il est seul à l'écran, faute d'état pour monter le
shell. Tant qu'il couvre l'application, celle-ci est cachée à TalkBack, et le
retrait passe par un minuteur, pas par la fin de l'animation : une couche
invisible qui ne partirait jamais avalerait tous les appuis. Le test avance
d'une durée fixe, pas de la constante : un test qui avance de la constante
qu'il vérifie passe à n'importe quelle valeur.

**Deux couleurs de la palette ne sont pas celles du design system.** Telles que
fournies, `neutral600` donnait 3,5:1 au texte secondaire de 11 pt et
`neutral700` 2,7:1 aux bordures d'interrupteur — sous AA dans un cas, sous le
3:1 exigé d'un contrôle dans l'autre. Rien de tout ça ne se voit sur une
capture, dans une pièce sombre, sur un bon écran : ça se voit sur un téléphone
posé sur un rebord de fenêtre en plein jour, et dans le rapport de pré-lancement
de Play. `__tests__/contrast.test.ts` calcule les ratios contre **les fonds sur
lesquels le texte est réellement dessiné** — il y en a trois — et la liste des
paires est un registre de décisions comme la liste des licences. Corollaire :
`neutral700` n'est pas une couleur de texte, et le message de veille du viseur,
qui l'utilisait, est passé à `neutral500` — c'est le seul texte à l'écran quand
l'application ne fonctionne pas.

**Un bouton qui dessine quelque chose doit montrer qu'on l'a pressé.**
`OutlineButton` le faisait depuis toujours et rien d'autre — y compris le bouton
pour lequel toute l'application existe. Sur un téléphone qu'on tape sans le
regarder, un contrôle qui ne réagit qu'une fois son état changé se lit comme un
appui manqué, et le deuxième appui défait le premier. Le ripple d'Android ne
rattrape rien ici : ce sont des `Pressable` stylés comme des vues.
`__tests__/touchFeedback.test.ts` lit la source plutôt qu'un rendu — `style` est
une fonction, React la résout, et le nœud hôte ne porte que le résultat de
l'état où il se trouvait. La règle porte ses propres exemptions : un `Pressable`
**avec enfants** dessine quelque chose, donc il doit un retour *et* un rôle ; un
`Pressable` sans enfant est un fond de scène ou une couche de rejet, invisible
par construction. Le seul rôle dispensé de retour est `switch`, dont le bouton
glisse — c'est le retour. Une seule vibration existe dans l'application, sur
démarrage/arrêt de la surveillance, et elle coûte `VIBRATE` au manifeste :
`src/utils/haptics.ts` est toute la justification de cette ligne.

**Le serveur MCP est en Kotlin, sur l'appareil.** Une passerelle Node a existé
(`novaguard-mcp/`) : elle ne pouvait pas tourner dans Hermes, appelait une API
`/api/v1/*` qu'aucun téléphone ne servait, et était pourtant la partie la mieux
testée — elle a été supprimée. Le serveur est `android/…/surveillance/McpServerModule.kt`, et il répond depuis un
**instantané** que `AppStateContext` pousse quand l'historique ou les réglages
changent — jamais depuis le chemin d'image : une requête ne doit pas coûter une
image à l'analyse, ni l'analyse bloquer une requête. Les chemins de fichiers
traversent le pont parce qu'il faut ouvrir le clip, et ne repartent jamais :
`McpEvent.toJson` construit son objet champ par champ, la configuration est
**reconstruite** à partir d'une liste de clés plutôt que filtrée — un décapage ne
retire que les clés auxquelles on a déjà pensé, et `localStreamPin` vit dans le
même objet. Deux règles de déploiement portent le reste : **sans jeton, la socket
reste sur loopback** (c'est le jeton qui achète le Wi-Fi), et un média est refusé
s'il ne se canonicalise pas sous `filesDir`. Côté protocole, trois choses ne
doivent pas être reperdues, parce qu'elles décident si un client se connecte : la
version se **négocie** (l'imposer rejette tout client qui ne connaît pas déjà la
chaîne privée du serveur), une notification JSON-RPC ne reçoit **pas** de réponse
— elle se reconnaît à l'absence d'`id`, pas au nom de sa méthode, et
`notifications/initialized` est la première trame après la poignée de main —, et
`resources/list` rend des ressources concrètes quand `resources/templates/list`
rend les gabarits. Enfin les outils sont nommés `novaguard_*` : le point de
`mcp.md` est hors du motif que l'API Claude accepte, donc un catalogue pointé est
un catalogue qu'aucun client ne charge ; la forme pointée reste acceptée à
l'appel. Le Kotlin n'est compilé par aucun garde-fou de PR ordinaire — `check` ne
lance pas Gradle — donc il se vérifie en construisant un APK.

Trois erreurs y ont faussé ce qu'un agent lisait, sans qu'aucune requête n'échoue. Les identifiants d'évènement sont des **millisecondes epoch** (`nextEventId`) : une borne `Int` refusait chaque évènement réel de `get_event`. La confiance est stockée en **pourcentage** et promise sur `[0,1]` : `unitConfidence` convertit dans l'instantané, sinon `minConfidence: 0.6` gardait tout. Et `surveillanceActive` seul disait « caméra active » d'un objectif masqué : l'instantané porte `surveillanceStatus`, et `statusSince` est tenu côté natif d'une poussée à l'autre. Ce qui se décide sans Android vit dans `McpRules.java`, compilé et testé par `scripts/test-presence-native.sh` en CI — c'est le seul morceau du serveur qu'une PR ordinaire exécute. Enfin les connexions passent par `McpRules.ConnectionGate` (8 au total, 4 par pair) et une échéance de 15 s par requête : un délai par lecture se renouvelle à chaque octet, donc un pair du Wi-Fi qui en envoyait un par seconde gardait un thread pour toujours, dans le processus qui fait tourner la caméra. Un agent regarde une vidéo par **images**, pas par fichier : la ressource `video/` part en base64 d'un bloc (plafonnée à 20 Mo, illisible pour la plupart des clients), alors que `get_event_frames` rend des blocs `image` — le format qu'un modèle voit. Les images sont décodées **déjà réduites** (`getScaledFrameAtTime` : une image 4K pleine taille, c'est 33 Mo de bitmap), une extraction à la fois (`McpFrames.decoding`), parce que le décodage prend les mêmes cœurs que l'analyse. Recadrées sur le sujet (`framing: "subject"`), elles s'appuient sur la trace que chaque évènement garde (`subjectTrail.ts` : un point par seconde au plus, trente par clip) — stockée avec le journal, donc grossière exprès — et le cadre est **large** (`McpRules.subjectCrop`) : l'échantillon peut dater d'une seconde, et un recadrage qui coupe les mains est le zoom sur le visage que l'application a déjà abandonné.

**Un agent pilote la caméra à travers l'application, jamais à côté.** Le pilotage existe parce qu'un agent qui ne peut que lire ne peut ni relancer une surveillance arrêtée ni relever un seuil qui enregistre le bruit. Trois verrous le tiennent, et aucun n'est décoratif. L'**interrupteur de l'appareil** (`mcpControlEnabled`, éteint par défaut) décide si les outils de pilotage existent — absents de `tools/list` sinon ; le **jeton de pilotage**, distinct du jeton de lecture, décide qui s'en sert, et la boucle locale lit sans jeton mais ne pilote jamais sans lui (`McpRules.principal`) : une autre app du téléphone ne doit pas pouvoir éteindre la caméra. Et le serveur ne touche à rien : une commande part en évènement vers le JS, `executeMcpCommand` l'exécute avec **les mêmes callbacks que les boutons** et répond — un « stop » d'agent est donc exactement le « stop » de l'écran, son de confirmation et journal compris. Sept commandes, toutes réversibles d'un coup d'œil — la septième, `annotate_event`, ne fait qu'écrire un verdict que le propriétaire voit sur la carte et efface d'un geste ; ce dont le dommage ne se découvre qu'après (suppression, zone, rétention, PIN, jeton) reste refusé par nom. Chaque appel, refus compris, va dans `agentLog.ts`, affiché dans Réglages. Le prix assumé : Android ne laisse démarrer un service caméra qu'application au premier plan, donc `start_surveillance` depuis l'arrière-plan est refusé avec la raison plutôt que tenté. `wait_for_event` est une longue attente (25 s au plus) sur le transport existant : le serveur n'a pas de flux pour pousser, et un agent qui interroge chaque seconde coûterait une requête et une place de connexion par seconde. Le jeton de pilotage **expire** (`mcpControlTtl`, 24 h par défaut), et c'est le serveur qui l'applique (`McpRules.controlLive`) : un JS endormi ne doit pas pouvoir prolonger un jeton. Expiré, il n'ouvre plus rien, pas même la lecture — c'est l'identifiant que le propriétaire voulait voir cesser, et le rétrograder en silence garderait un agent oublié à regarder. La notification de surveillance porte « Couper le pilotage » tant qu'un agent peut piloter : le serveur jette l'empreinte **avant** de prévenir le JS, donc aucun appel ne passe après le geste, quel que soit l'état du pont. La **vue en direct** (`get_live_frame`) a son propre interrupteur, éteint par défaut : voir la pièce à la demande n'est pas relire ce qui a été filmé. Côté chemin d'image, `LiveFramePlugin` est appelé deux fois par seconde et ne lit qu'un volatile tant qu'aucune requête n'attend ; la copie YUV se fait sur le thread caméra parce que l'image n'est valide que là, tout le reste sur un thread à part. **HTTPS** est une option, pas le défaut — un client qui ne fait pas confiance au certificat cesserait de se connecter — et repose sur une autorité **propre au téléphone** : sa clé est dans l'Android Keystore, le propriétaire installe son certificat une fois, et le certificat serveur est réémis à la poignée de main suivante quand l'IP change (`McpTls.ReissuingKeyManager`). Épingler un certificat auto-signé aurait cassé chaque client au premier nouveau bail DHCP. `McpCertificates.java` construit le X.509 sans bibliothèque ; le test JVM le relit, vérifie la chaîne et s'en sert pour une vraie poignée de main TLS, refus d'une autre autorité compris. Les prompts (`McpPrompts.java`) écrivent leurs fenêtres en instants calculés dans le fuseau du téléphone : un agent ne le connaît pas, et une nuit calculée en UTC est la mauvaise nuit pour tout le monde sauf Greenwich.

**Une erreur d'outil et une erreur de protocole ne vont pas au même endroit.**
Ce partage n'est pas cosmétique : un outil qui
s'exécute et ne peut pas répondre rend un **résultat** portant `isError`, seule
forme que le modèle qui a posé la question voit — en erreur JSON-RPC elle lui est
invisible, et « l'évènement 9999 n'existe pas » ressemble alors à un serveur cassé
plutôt qu'à un identifiant à corriger. Ce qui n'a **pas** atteint un outil reste
une erreur JSON-RPC, parce qu'aucun argument ne la corrigerait : méthode inconnue
(`-32601`), outil inconnu (`-32602`), opération de mutation refusée, autorisation
manquante. D'où deux contrôles placés exprès *avant* la conversion — le refus
d'une opération et le nom d'outil inconnu — et une ressource introuvable en
`-32002`. Et le pendant côté entrée : **un schéma d'outil qui n'est pas appliqué
ment**. `additionalProperties: false` et les énumérations étaient déclarés et
jamais lus, donc un filtre mal orthographié rendait l'historique non filtré avec
un 200. La validation dérive du schéma annoncé, jamais d'une table posée à côté :
deux copies du contrat divergent au premier paramètre ajouté.

**Un contrôle de sécurité qui marche et un qui protège ne se distinguent pas à
l'usage.** Un jeton comparé par `==` authentifie exactement les mêmes appelants
qu'un jeton comparé à temps constant, et une table non bornée est correcte
jusqu'à ce que le processus manque de mémoire. Les jetons sont donc gardés **et**
comparés par empreinte SHA-256 (`MessageDigest.isEqual`), la table de débit est
élaguée, et `Origin` n'est envoyé que par les navigateurs : son absence est
acceptée et **`Host` est le contrôle qui couvre les autres** — les deux ensemble
sont la défense contre le *DNS rebinding*. Un `401` porte `WWW-Authenticate`,
sans quoi un client n'apprend rien de ce qui le rendrait autorisé.

**Un clip conservé n'appartient plus aux balayages.** `kept` se pose par passage (`keptEventIds` étend le drapeau aux segments écrits après) et retire l'évènement de `expiredEvents` comme de `eventsToReclaim` : un disque plein arrête d'enregistrer, il n'efface jamais une preuve. Seule une suppression explicite l'atteint.

**Un clip sans événement est une vidéo perdue.** Le sort d'un enregistrement est
exhaustif (`clipOutcome`) : rattaché, gardé comme événement sans fichier, ou
supprimé. Il n'y a pas de quatrième issue, et il ne doit pas y en avoir.

**Une lecture qui échoue n'est pas une valeur vide.** Le balayage de démarrage
supprime tout clip que plus aucun évènement ne réclame ; un chargeur qui répond
`null` pour « illisible » comme pour « jamais écrit » lui fait donc effacer
toute la bibliothèque. Ce qui peut détruire quelque chose lit à travers
`readJsonChecked` et s'abstient quand `ok` est faux — sans réécrire non plus la
clé qu'il n'a pas su lire.

**Les frontières de jour se calculent en jours calendaires**, via
`startOfDayBefore` — et côté serveur MCP, en jours locaux aussi (`Snapshot.timeline`,
`statisticsForPeriod`), pour que « aujourd'hui » désigne le même jour partout.
Soustraire 86 400 000 ms ne décale pas d'une heure mais peut changer de jour :
au 31 mars 2025, le 30 ne dure que 23 h, donc le retrait naïf atterrit sur le 29.
C'est la rétention — donc une suppression — qui en dépend. `jest.config.js` fixe
`TZ=Europe/Paris` pour que ces tests puissent échouer ; sous UTC, minuit local et
minuit UTC sont le même instant et tout passe.

**Ce que les défauts ne nomment pas ne survit pas à l'hydratation.** La fusion
pose l'objet stocké **par-dessus** `defaultSettings`, ce qui couvre un champ
ajouté depuis. Elle gardait aussi tout champ *retiré* depuis : il restait dans
l'état, était réécrit à la sauvegarde suivante et survivait au code qui le
lisait, si bien qu'un réglage ne pouvait qu'être ignoré, jamais supprimé.
`mergeStoredSettings` ne retient que les clés des défauts.

**Un réglage se vérifie de bout en bout.** Ce dépôt a déjà livré une section
NOTIFICATIONS entièrement inerte. Un réglage doit être exposé, persisté *et*
consommé ; `__tests__/settingsWiring.test.tsx` verrouille les trois.

**`check` ne compile aucune ressource Android.** Un `--` dans un commentaire XML
a cassé tous les builds d'APK sans qu'aucune PR verte ne le signale. D'où l'étape
`xmllint` dans le job `check`. Une erreur Android ne peut pas être attrapée par
tsc, eslint ou jest.

**Et `xmllint` ne lance pas Gradle.** Bien formé n'est pas compilable : un
manifeste fautif, un module natif qui réclame un autre NDK, une dépendance dont
le code autolié ne compile pas — rien de tout cela ne se voit avant un vrai run
Gradle. Le job `changes` de `ci.yml` décide donc, par PR et d'après les fichiers
touchés, s'il faut construire un APK ; une PR purement JavaScript ne paie
toujours rien. La liste des chemins exclut volontairement le `Dockerfile` et les
scripts de build, qu'`android-image.yml` couvre déjà sur PR — les nommer aux
deux endroits téléchargerait deux fois plusieurs gigaoctets de SDK.
`__tests__/apkOnPullRequest.test.ts` rejoue la vraie expression extraite du
workflow : une décision qui vit dans un `grep` de CI ne s'exercerait sinon que
lors d'un run Actions, c'est-à-dire trop tard.

**Une dépendance qui réclame un autre NDK casse le build.** L'image porte
exactement ce que `android/build.gradle` épingle, et rien d'autre : un module
qui demande autre chose fait tenter à AGP un téléchargement dans un SDK en
lecture seule, et ça s'arrête là. Deux cas déjà présents — `worklets-core` ne
déclare aucun `ndkVersion` (AGP retombe sur le sien), le détecteur de visages
code en dur NDK 27.3/plateforme 35/build-tools 35, et **aucun** module natif ne
fixe de version de CMake, donc tous héritent du défaut d'AGP (3.22.1) au lieu du
3.30.5 que l'image installe. Et ça ne casse pas d'un coup : se mettre d'accord
sur le NDK n'a fait avancer le build que jusqu'à `configureCMake…`. Le bloc
`subprojects` de `android/build.gradle` force les quatre valeurs sur **tous** les
modules Android
plutôt que de les poursuivre un par un, et `__tests__/toolchainPinning.test.ts`
vérifie que `build.gradle`, le `Dockerfile` et les assertions d'`android-image.yml`
nomment bien les mêmes versions pour chacune des quatre — l'échec, lui, ne se voit que dans un vrai run
Gradle, que la CI ne fait pas sur une PR ordinaire.

## Livrer une release

Le détail — image Docker, scripts, signature, App Bundle, workflows CI — est
dans la compétence `release-android` et dans `docs/PLAY_STORE.md`. Trois choses
ne s'apprennent pas au moment où on en a besoin :

- **R8 reste désactivé.** Toutes les dépendances lourdes atteignent du natif par
  leur nom : l'activer sans règles vérifiées sur matériel échange des mégaoctets
  contre un crash qu'aucun test unitaire ne voit.
- **`INTERNET` est déclarée ; une seule connexion sortante existe, et elle est
  optionnelle.** Le direct Wi-Fi et le serveur MCP sont deux serveurs locaux
  éteints par défaut qui ne font qu'écouter. L'« accès depuis le cloud »
  (`McpRelayClient.kt`, `relay/`, `docs/CONNEXION.md` §14) ouvre une connexion
  sortante vers le relais du projet, éteinte par défaut, derrière un consentement
  qui nomme le relais. `playRelease.test.ts` vérifie dans les sources JS et Kotlin
  que **ce fichier est le seul** à pouvoir ouvrir une connexion : en ajouter un
  autre, c'est changer `PRIVACY.md`, `PRIVACY.en.md` et le formulaire *Data
  safety*, pas seulement le test. Une requête venue du relais n'est **jamais** une
  requête de boucle locale (`McpRules.relayPrincipal` : lecture avec le jeton
  d'accès, jamais de pilotage), parce que ses trames sont livrées de l'intérieur
  du processus. Le relais termine TLS et voit le trafic en clair : c'est écrit
  dans le consentement, et c'est accepté. Longtemps le formulaire et `PRIVACY.md`
  ont affirmé l'absence de la permission, qui était fausse. Chaque type de service
  de premier plan doit être couvert par sa permission ; le même test tient la
  liste.
- **`bundleRelease` échoue sans la clé d'upload, et c'est voulu.** Un bundle
  mal signé coûte un `versionCode` définitivement brûlé dans la Play Console.

## Tests

Jest, avec des mocks pour tout ce qui est natif (`__mocks__/`,
`src/surveillance/__mocks__/`). `testing/mountProvider.tsx` monte
`AppStateProvider` — lisez l'état à travers le handle, pas une copie
déstructurée, qui fige le premier rendu.

Ce qu'aucun mock ne prouve — capteur, encodeur, réseau, Android qui bride
l'application — est listé dans `docs/DEVICE_CHECKS.md`, à dérouler sur
téléphone avant une release qui y touche.

Écrire un test qui ne peut pas échouer est pire que ne pas en écrire : plusieurs
l'ont été ici et ont dû être réécrits. Vérifiez par mutation — cassez le code,
regardez le test échouer, restaurez.

## Conventions

- Java 17, `minSdk`/`compileSdk`/`targetSdk` 36, un seul niveau de plateforme —
  imposé aux dépendances aussi, voir plus bas.
- Fusion par commit de merge, pas de squash.
- Le CHANGELOG suit Keep a Changelog ; les changements visibles y vont.
