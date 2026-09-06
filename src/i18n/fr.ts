/**
 * The source catalogue. Every user-visible string in the app is here, in the
 * language it was written in.
 *
 * French is the fallback rather than English because that is what this app's
 * text was authored in and reviewed in: a key missing from `en.ts` is a
 * compile error (see its type), and a key missing from a future third locale
 * falls back to prose someone actually wrote.
 *
 * Keys are grouped by where they appear, not by what they say — moving a
 * string between screens should be a visible rename, not a silent reuse.
 *
 * @format
 */

export const fr = {
  // ── shell ────────────────────────────────────────────────────────────
  'tab.cam': 'Caméra',
  'tab.hist': 'Historique',
  'tab.setup': 'Setup',

  // ── surveillance screen ──────────────────────────────────────────────
  'surv.tagline': 'Caméra intelligente locale',
  'surv.status.on': 'Surveillance active',
  'surv.status.off': 'Surveillance inactive',
  'surv.cta.start': 'DÉMARRER LA SURVEILLANCE',
  'surv.cta.stop': 'ARRÊTER LA SURVEILLANCE',
  'surv.stat.last': 'Dernière',
  'surv.stat.today': "Aujourd'hui",
  'surv.stat.space': 'Espace',

  // ── viewfinder ───────────────────────────────────────────────────────
  'view.standby': 'CAMÉRA EN VEILLE',
  'view.noCamera': 'AUCUNE CAMÉRA DÉTECTÉE',
  'view.grantCamera': 'AUTORISEZ LA CAMÉRA',
  'view.grantCameraWhere': 'Setup → Confidentialité → Permissions',
  'view.overlay.person': 'Personne détectée · enregistrement',
  'view.overlay.animal': 'Animal détecté · enregistrement',
  'view.overlay.none': 'Aucune détection',
  'view.overlay.idle': 'Caméra en veille',
  // What the capture zoom costs: at z, only 1/z² of the sensor is left, and
  // what falls outside reaches neither the file nor the detector.
  'view.coverage': 'Champ réduit · {percent} %',
  'view.zoom.close': 'PLAN SERRÉ',
  'view.zoom.wide': 'PLAN LARGE',

  // ── history ──────────────────────────────────────────────────────────
  'hist.title': 'Historique',
  'hist.count.one': '{count} vidéo',
  'hist.count.other': '{count} vidéos',
  'hist.empty': 'Aucun événement pour ce filtre.',
  'hist.empty.reset': 'Voir tout',
  'hist.empty.never': 'Rien n’a encore été filmé.',
  'hist.empty.never.sub': 'Démarrez la surveillance depuis l’onglet Caméra : chaque personne ou animal confirmé écrira une vidéo ici.',
  'hist.event.person': 'Personne détectée',
  'hist.event.animal': 'Animal détecté',
  'hist.event.meta': '{dur} secondes · {conf} %',

  // ── event detail ─────────────────────────────────────────────────────
  'detail.play': "Lire l'enregistrement",
  'detail.noClip': 'AUCUNE VIDÉO POUR CET ÉVÈNEMENT',
  'detail.when': 'Date & heure',
  'detail.type': 'Type',
  'detail.duration': 'Durée',
  'detail.seconds': '{dur} secondes',
  'detail.confidence': 'Confiance',
  'detail.percent': '{value} %',
  'detail.size': 'Taille',
  'detail.file': 'Fichier',
  'detail.share': 'Partager',
  'detail.delete': 'Supprimer',
  'detail.close': 'Fermer',

  // ── setup ────────────────────────────────────────────────────────────
  'setup.title': 'Setup',
  'setup.section.surv': 'SURVEILLANCE',
  'setup.section.det': 'DÉTECTION',
  'setup.section.rec': 'ENREGISTREMENT',
  'setup.section.sto': 'STOCKAGE',
  'setup.section.not': 'NOTIFICATIONS',
  'setup.section.about': 'À PROPOS',

  'setup.camera': 'Caméra utilisée',
  'setup.resume': "Reprendre à l'ouverture",
  'setup.resume.sub': 'Android interdit à la caméra de démarrer seule après un redémarrage',
  'setup.night': 'Mode nuit',
  'setup.night.sub': 'Disponible sur cet appareil',

  'setup.person': 'Détecter les personnes',
  'setup.animal': 'Détecter les animaux',
  'setup.autoTuneSwitch': 'Auto-réglage',
  'setup.autoTuneSwitch.sub': 'Retire du calcul quand l’appareil n’analyse plus assez d’images. Ne rallume jamais ce que vous avez éteint.',
  'setup.autoZoom': 'Zoom auto sur les personnes',
  'setup.autoZoom.sub': 'Plan serré 4 s, puis plan large sur la scène',
  'setup.forceCpu': 'Détection sur le processeur',
  'setup.forceCpu.sub': 'À essayer si rien n’est jamais détecté : force le calcul sur le CPU',
  'setup.precise': 'Détection étendue',
  'setup.precise.sub': 'Modèle 448 px : bien meilleur sur les sujets lointains, environ trois fois plus de calcul',
  'setup.zone': 'Zone de détection',
  'setup.zone.sub': 'Ne surveiller qu\u2019une partie du champ — la rue et le trottoir cessent de déclencher',
  'setup.zone.all': 'Toute l\u2019image',
  'setup.zone.set': 'Définie',
  'setup.zone.define': 'Définir',
  'zone.hint': 'Faites glisser sur l\u2019image pour délimiter la zone surveillée',
  'zone.tooSmall': 'Zone trop petite pour être utilisable',
  'zone.save': 'Enregistrer',
  'zone.all': 'Toute l\u2019image',
  'zone.cancel': 'Annuler',
  'setup.sens': 'Sensibilité',
  'setup.sens.hint.Basse': '1 image par seconde — économe : une seule image suffit à déclencher, mais elle doit être plus nette',
  'setup.sens.hint.Moyenne': '3 images par seconde — confirme un sujet sur deux images consécutives',
  'setup.sens.hint.Haute': '5 images par seconde — la plus réactive et la plus indulgente, batterie la plus sollicitée',
  'setup.threshold': 'Seuil de confiance',

  'setup.post': 'Durée après détection',
  'setup.max': 'Durée max. par clip',
  'setup.max.sub': 'L’enregistrement continue tant qu’un sujet est visible : au-delà, il se poursuit dans un nouveau clip',
  'setup.quality': 'Qualité vidéo',
  'setup.quality.sub4k': 'Le 4K quadruple aussi le coût de l’analyse des images',

  'setup.storage.used': 'Utilisé',
  'setup.storage.free': 'Disponible',
  'setup.storage.videos': 'Vidéos',
  'setup.retention': 'Conserver les vidéos',
  'setup.autoDel': 'Suppression automatique',
  'setup.autoDel.sub': 'Quand le stockage devient insuffisant',
  'setup.wipe': 'Supprimer toutes les vidéos',

  'setup.notif': 'Notifications activées',
  'setup.notifDet': 'À chaque détection',
  'setup.sound': 'Son et vibration (Android)',
  'setup.sound.hint': "Depuis Android 8, le son et la vibration d'une notification appartiennent au système, pas à l'application.",

  'setup.version': 'Version',
  'setup.license': 'Licence',
  'setup.license.sub': 'Logiciel libre et open source',
  'setup.autoTune': 'Paramètres dynamiques',
  'setup.clipGap': 'Coupure entre deux clips',
  'setup.source': 'Code source',
  'setup.report': 'Signaler un bug',
  'setup.thirdParty': 'Licences tierces',

  'setup.privacy': 'CONFIDENTIALITÉ',
  'setup.privacy.heading': 'Traitement local',
  'setup.privacy.body': "La détection s'exécute sur l'appareil. Les vidéos restent sur votre téléphone et ne sont jamais envoyées sur un serveur.",
  'setup.privacy.perms': 'Permissions',
  'setup.privacy.data': 'Données stockées',

  // ── what a screen reader says, where the visible text is not enough ──
  'a11y.setting': '{name} : {value}',
  'a11y.allow': 'Autoriser {name}',
  'a11y.dismiss': 'Fermer',
  'a11y.period': 'Période : {value}',
  'a11y.event': '{title}, {when}',

  // ── info sheets ──────────────────────────────────────────────────────
  'info.perms': 'Permissions',
  'info.data': 'Données stockées',
  'info.licenses': 'Licences tierces',
  'info.close': 'Fermer',
  'info.allow': 'Autoriser',
  'info.perm.cam': 'Caméra',
  'info.perm.cam.note': 'Flux vidéo local',
  'info.perm.cam.granted': 'Autorisée',
  'info.perm.mic': 'Microphone',
  'info.perm.mic.note': 'Audio des vidéos',
  'info.perm.mic.granted': 'Autorisé',
  'info.perm.notif': 'Notifications',
  'info.perm.notif.note': 'Alertes de détection',
  'info.perm.notif.granted': 'Autorisées',
  'info.perm.storage': 'Stockage',
  'info.perm.storage.note': 'Écriture des vidéos',
  'info.perm.storage.granted': 'Autorisé',
  'info.data.clips': 'Vidéos enregistrées',
  'info.data.clips.note': "Dossier privé de l'application",
  'info.data.clips.value.one': '{count} fichier · {size}',
  'info.data.clips.value.other': '{count} fichiers · {size}',
  'info.data.journal': 'Journal de détection',
  'info.data.journal.note': 'Type, heure, confiance',
  'info.data.settings': 'Réglages',
  'info.data.settings.note': 'Préférences et compteurs',
  'info.data.sent': 'Envoyé sur un serveur',
  'info.data.sent.note': 'Aucune donnée sortante',
  'info.data.sent.value': 'Rien',

  // ── onboarding ───────────────────────────────────────────────────────
  'onb.welcome': 'BIENVENUE',
  'onb.headline': 'NovaGuard transforme\nce téléphone en caméra.',
  'onb.step1': 'Détection locale',
  'onb.step1.body': 'Les personnes et les animaux sont reconnus directement sur l’appareil.',
  'onb.step2': 'Enregistrement automatique',
  'onb.step2.body': 'La vidéo démarre dès qu’une détection est confirmée.',
  'onb.step3': 'Vidéos conservées localement',
  'onb.step3.body': 'Rien ne quitte votre téléphone, aucun compte n’est requis.',
  'onb.continue': 'CONTINUER',
  'onb.perms': 'AUTORISATIONS',
  'onb.perms.headline': 'Trois accès, demandés\nun par un.',
  'onb.perms.sub': 'Vous pouvez refuser la notification et le micro : la surveillance fonctionnera quand même.',
  'onb.perm.cam.note': 'Indispensable à la surveillance',
  'onb.perm.mic.note': 'Son des enregistrements',
  'onb.perm.notif.note': "Alerte lors d'une détection",
  'onb.granted': 'Autorisé',
  'onb.grant': 'Autoriser',
  'onb.start': 'COMMENCER',
  'onb.blocked': "AUTORISER LA CAMÉRA D'ABORD",

  // ── splash ───────────────────────────────────────────────────────────
  'splash.tagline1': 'DÉTECTION INTELLIGENTE',
  'splash.tagline2': 'PERSONNES & ANIMAUX',
  'splash.detect': 'Détecte',
  'splash.detect.sub': 'en temps réel',
  'splash.record': 'Enregistre',
  'splash.record.sub': 'automatiquement',
  'splash.protect': 'Protège',
  'splash.protect.sub': 'vos données',
  'splash.loading': 'Initialisation en cours…',

  // ── confirmations ────────────────────────────────────────────────────
  'confirm.cancel': 'Annuler',
  'confirm.delete.title': 'Supprimer cette vidéo ?',
  'confirm.delete.body': 'La vidéo sera définitivement supprimée de votre appareil. Cette action est irréversible.',
  'confirm.delete.ok': 'Supprimer',
  'confirm.wipe.title': 'Supprimer toutes les vidéos ?',
  'confirm.wipe.body.one': '{count} vidéo sera supprimée de cet appareil. Cette action est irréversible.',
  'confirm.wipe.body.other': '{count} vidéos seront supprimées de cet appareil. Cette action est irréversible.',
  'confirm.wipe.ok': 'Tout supprimer',

  // ── errors shown to the user ─────────────────────────────────────────
  'error.historyUnreadable': 'Historique illisible : les vidéos sont conservées',
  'error.grantCamera': 'Autorisez la caméra pour démarrer la surveillance',
  'error.model': 'Modèle de détection impossible à charger',
  'error.camera': 'Caméra : {message}',
  'error.frame.interrupted': "Analyse d'image interrompue",
  'error.frame.detail': "Analyse d'image : {message}",
  'error.frame.duringStage': 'Analyse d’image interrompue pendant {stage}',
  // The first word of each message above, and the *only* thing that tells the
  // camera path which banners it may take down again (see CAMERA_OWNED_ERROR).
  // Translating a message without its prefix would leave an error stuck on
  // screen for the rest of the session, in silence.
  'error.prefix.camera': 'Caméra',
  'error.prefix.model': 'Modèle',
  'error.prefix.frame': 'Analyse',

  // ── frame stages, named in the two messages above ────────────────────
  'stage.camera': 'l’ouverture de la caméra',
  'stage.resize': 'la mise à l’échelle de l’image',
  'stage.inference': 'la détection (modèle)',
  'stage.faces': 'la détection de visages',
  'stage.report': 'la remontée des résultats',

  // ── self-tuning, decided from the measured frame rate ────────────────
  'autoTune.none': 'Rien retiré',
  'autoTune.watching': 'Lancez la surveillance : la mesure vient des images analysées',
  'autoTune.shortfall': 'L’appareil analyse {measured} au lieu de {target} : retiré pour lui rendre du calcul',
  'autoTune.noGain': 'Rendu : {measured} au lieu de {target}, le retrait n’y changeait rien',
  'autoTune.restored': 'L’appareil suit la cadence demandée ({measured} sur {target})',

  // ── the dynamic-parameters screen ────────────────────────────────────
  'autoTune.screen.title': 'Paramètres dynamiques',
  'autoTune.screen.intro': 'Ce que l’application ajuste seule, d’après la cadence qu’elle mesure. Elle ne peut que retirer ce que vous avez demandé, jamais activer ce que vous avez éteint.',
  'autoTune.screen.empty': 'Aucune mesure pour l’instant : la cadence est prélevée sur les images analysées, donc elle commence avec la surveillance.',
  'autoTune.chart.cadence': 'Cadence analysée',
  'autoTune.chart.cadence.a11y': 'Cadence analysée sur les {count} dernières fenêtres : dernière {last}, moyenne {mean}, cible {target}.',
  'autoTune.chart.step.a11y': '{name} : {state}. Actif sur {on} des {total} dernières fenêtres.',
  'autoTune.stat.last': 'Dernière',
  'autoTune.stat.mean': 'Moyenne',
  'autoTune.stat.target': 'Cible',
  'autoTune.uptime': 'Actif sur {on} des {total} fenêtres mesurées',
  'autoTune.state.on': 'Actif',
  'autoTune.state.given': 'Retiré',
  'autoTune.state.off': 'Éteint par vous',
  'autoTune.state.blocked': 'Rendu — sans effet ici',
  'autoTune.axis.now': 'maintenant',
  'autoTune.axis.past.s': 'il y a {count} s',
  'autoTune.axis.past.min': 'il y a {count} min',
  'autoTune.window': 'Une barre par fenêtre de {seconds} s',

  // ── what the platform says about heat and power ──────────────────────
  'deviceLoad.thermal.nominal': 'Température normale',
  'deviceLoad.thermal.warm': 'Appareil chaud',
  'deviceLoad.thermal.hot': 'Appareil en surchauffe',
  'deviceLoad.battery': 'Batterie {percent} %',
  'deviceLoad.battery.charging': 'Batterie {percent} % · en charge',
  'deviceLoad.unknown': 'L’appareil ne rapporte ni température ni batterie',
  'autoTune.throttled': 'L’appareil est ralenti par la chaleur : ce qui a été retiré reviendra en refroidissant',
  'setup.deviceLoad': 'État de l’appareil',

  // ── clip gap, measured on the device ─────────────────────────────────
  'clipGap.none': 'Pas encore mesuré',
  'clipGap.tooShort': 'Filmez un passage plus long que la durée max. par clip pour obtenir une mesure',
  'clipGap.cuts.one': '1 coupure',
  'clipGap.cuts.other': '{count} coupures',
  'clipGap.detail': '{cuts} · pire {worst} · dernière : {finalize} de finalisation + {restart} de relance',

  // ── units, which are neither universal nor decorative ────────────────
  'unit.kb': 'Ko',
  'unit.mb': 'Mo',
  'unit.gb': 'Go',
  // A French reader parses "1,5 Go"; an English one parses "1.5 GB". Getting
  // this wrong turns a size into a different number, not just a foreign one.
  'number.decimal': ',',

  // ── notifications ────────────────────────────────────────────────────
  'notif.title': 'Surveillance active',
  'notif.monitoring': 'NovaGuard analyse la caméra. Tout reste sur cet appareil.',
  'notif.person': 'Personne détectée',
  'notif.animal': 'Animal détecté',

  // ── third-party licence notes, shown in Setup → À propos ─────────────
  'lic.react-react-native': 'Framework applicatif',
  'lic.react-native-vision-camera': 'Flux caméra et frame processors',
  'lic.react-native-fast-tflite': 'Inférence TensorFlow Lite embarquée',
  'lic.react-native-vision-camera-face-detector': 'Détection de visages (ML Kit)',
  'lic.vision-camera-resize-plugin': 'Redimensionnement des frames caméra',
  'lic.dr-pogodin-react-native-fs': 'Fichiers vidéo et espace disque',
  'lic.react-native-video': 'Lecture des enregistrements',
  'lic.react-native-worklets-core': 'Traitement des frames hors thread JS',
  'lic.efficientdet-lite0-coco': 'Modèle de détection embarqué',
  'lic.efficientdet-lite2-coco': 'Modèle de détection étendu',
  'lic.react-native-safe-area-context': 'Zones sûres de l’écran',
  'lic.react-native-svg': 'Icônes vectorielles',
  'lic.react-native-linear-gradient': 'Dégradés visuels',
  'lic.react-native-community-slider': 'Curseur du seuil de confiance',
  'lic.react-native-async-storage-async-storage': 'Sauvegarde locale des réglages',
  'lic.androidx-core': 'Notification du service de premier plan',
  'lic.inter': 'Police de caractères',

  // ── dates ────────────────────────────────────────────────────────────
  'date.today': "Aujourd'hui, {time}",
  'date.yesterday': 'Hier, {time}',
  'date.other': '{day} {month}, {time}',
  'date.dayToday': "Aujourd'hui",
  'date.dayYesterday': 'Hier',
  'date.dayOther': '{day} {month}',
  'date.months': 'janv.,févr.,mars,avr.,mai,juin,juil.,août,sept.,oct.,nov.,déc.',

  // ── stored values, displayed ─────────────────────────────────────────
  // The unions in `state/types.ts` are French identifiers written to disk and
  // compared by the tracker. They are never translated, only *displayed*
  // through these keys — renaming a variant would orphan every stored event.
  'value.kind.Personne': 'Personne',
  'value.kind.Animal': 'Animal',
  'value.filter.Toutes': 'Toutes',
  'value.filter.Personnes': 'Personnes',
  'value.filter.Animaux': 'Animaux',
  "value.period.Aujourd'hui": "Aujourd'hui",
  'value.period.7 jours': '7 jours',
  'value.period.30 jours': '30 jours',
  'value.period.Tout': 'Tout',
  'value.sens.Basse': 'Basse',
  'value.sens.Moyenne': 'Moyenne',
  'value.sens.Haute': 'Haute',
  'value.autoTune.autoZoom': 'Zoom auto',
  'value.autoTune.sensitivity': 'Un cran de sensibilité',
  'value.autoTune.precise': 'Détection étendue',
  'value.camera.Arrière (1×)': 'Arrière (1×)',
  'value.camera.Arrière (0,5×)': 'Arrière (0,5×)',
  'value.camera.Avant': 'Avant',
  'value.retention.1 jour': '1 jour',
  'value.retention.7 jours': '7 jours',
  'value.retention.30 jours': '30 jours',
  'value.retention.90 jours': '90 jours',
  'value.retention.Toujours': 'Toujours',
} as const;

export type StringKey = keyof typeof fr;
