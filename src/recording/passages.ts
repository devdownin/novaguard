import { DetectionEvent, DetectionKind } from '../state/types';

export interface Passage {
  id: string;
  events: DetectionEvent[];
  kinds: DetectionKind[];
  summary: DetectionEvent;
  missingCount: number;
}

/** Never infer identity from elapsed time: two nearby clips may be unrelated. */
export function groupPassages(events: DetectionEvent[]): Passage[] {
  const groups = new Map<string, DetectionEvent[]>();
  for (const event of events) {
    const key = event.passageId
      ? `passage:${event.passageId}`
      : `clip:${event.id}`;
    const group = groups.get(key) ?? [];
    group.push(event);
    groups.set(key, group);
  }
  return [...groups]
    .map(([id, clips]) => {
      const ordered = [...clips].sort(
        (a, b) => a.timestamp - b.timestamp || a.id - b.id,
      );
      const first = ordered[0];
      const playable = ordered.find(clip => clip.path != null);
      return {
        id,
        events: ordered,
        kinds: [...new Set(ordered.flatMap(clip => clip.kinds ?? [clip.kind]))],
        missingCount: ordered.filter(clip => clip.path == null).length,
        summary:
          ordered.length === 1
            ? first
            : {
                ...first,
                dur: ordered.reduce(
                  (sum, clip) => sum + (clip.path ? clip.dur : 0),
                  0,
                ),
                bytes: ordered.reduce((sum, clip) => sum + clip.bytes, 0),
                conf: ordered.reduce(
                  (max, clip) => Math.max(max, clip.conf),
                  0,
                ),
                path: playable?.path ?? null,
                thumbPath: playable?.thumbPath ?? null,
              },
      };
    })
    .sort(
      (a, b) =>
        b.summary.timestamp - a.summary.timestamp ||
        b.summary.id - a.summary.id,
    );
}
