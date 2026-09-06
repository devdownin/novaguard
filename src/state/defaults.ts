import { DetectionEvent, Settings } from './types';

export const defaultSettings: Settings = {
  camera: 'Arrière (1×)',
  resumeOnLaunch: true,
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
  autoZoom: true,
  autoTune: true,
  forceCpu: false,
  preciseDetection: false,
  zone: null,
  post: '10 s',
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
  exp: { surv: true, det: false, rec: false, sto: false, not: false, about: false },
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
