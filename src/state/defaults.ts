import { DetectionEvent, Settings } from './types';

export const defaultSettings: Settings = {
  camera: 'Arrière (1×)',
  resumeOnLaunch: true,
  lockHistory: false,
  night: true,
  person: true,
  animal: true,
  sens: 'Moyenne',
  /**
   * Score a detection needs to open a track (`startConfidence`), not to be
   * looked at: weaker boxes still keep an open track alive. 75 as a single gate
   * meant a subject at the end of a garden, or half in shadow, simply never
   * existed — EfficientDet-Lite0 scores those in the 0.4–0.6 range and wobbles
   * across any line drawn through it.
   */
  threshold: 60,
  animalThreshold: 60,
  autoZoom: true,
  autoTune: true,
  forceCpu: false,
  calibration: false,
  preciseDetection: false,
  zone: null,
  exclusions: [],
  post: '0 s',
  tolerance: '1 s',
  max: '2 min',
  quality: '1080p',
  /**
   * Sept jours, pas trente.
   *
   * La rétention supprime : un défaut plus long garde par défaut ce que
   * personne n'a demandé à garder, et c'est le disque du téléphone qui paie —
   * un mois de passages en 1080p dépasse ce que beaucoup d'appareils ont de
   * libre. Une semaine couvre le cas pour lequel on relit un enregistrement.
   * Ne concerne qu'une nouvelle installation : un réglage déjà écrit est
   * relu tel quel à l'hydratation.
   */
  retention: '7 jours',
  autoDel: true,
  notif: true,
  notifDet: true,
  notifPicture: true,
  quietHours: false,
  quietStart: 22,
  quietEnd: 7,
  localStreamEnabled: false,
  localStreamPort: 8080,
  localStreamPin: '',
  mcpEnabled: false,
  mcpPort: 8081,
  mcpToken: '',
  mcpControlEnabled: false,
  mcpControlToken: '',
  // A night, not forever: a token copied into a client config outlives the reason it was copied.
  mcpControlTtl: '24 h',
  mcpControlExpiresAt: 0,
  // Seeing the room on demand is more than reviewing what was filmed: asked for, not assumed.
  mcpLiveFrameEnabled: false,
  // Off until the owner has a client that trusts the device certificate: on by
  // default, every existing client would stop connecting.
  mcpTls: false,
  exp: { surv: true, det: false, rec: false, sto: false, not: false, stream: false, mcp: false, adv: false, about: false },
};

/**
 * Empty on purpose. Earlier versions seeded seven fabricated events here, which
 * the persistence layer then wrote to disk on first launch — leaving fake
 * recordings mixed into real history with no way to tell them apart.
 */
export const defaultEvents: DetectionEvent[] = [];

export const defaultDetToday = 0;
/** No detection yet — the screen shows a dash rather than a formatted nothing. */
export const defaultLastDetAt: number | null = null;
