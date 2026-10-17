import { useEffect, useRef, useState } from 'react';
import { Alert, AppState } from 'react-native';
import type { McpPendingAuthorization } from '../surveillance/mcpServer';
import { t } from '../i18n';

/**
 * Asks the owner whether an assistant at the relay may read. Renders nothing.
 *
 * The decision is taken here, on the phone: the web page the assistant sent them
 * to only shows a code, and nothing is issued until this is answered. One prompt
 * at a time; a request is offered once, and only while the app can show it — a
 * prompt marked as shown behind a locked screen would never be asked again.
 *
 * Mounted before the rest of the tree, so its `AppState` subscription is the
 * first one made: the screens' own are then still the last, which is what
 * `backgroundSaving.test.tsx` drives.
 */
/** The shorter of the two durations offered; the other is open-ended, until the owner revokes it. */
export const GRANT_DAY_MS = 24 * 3_600_000;

export function McpAuthPrompt({ enabled, pending, onAnswer }: {
  enabled: boolean;
  pending: McpPendingAuthorization[] | undefined;
  onAnswer: (id: string, allow: boolean, lifetimeMs?: number) => void;
}) {
  const prompted = useRef<string | null>(null);
  const open = useRef(false);
  // Only an explicit `background` counts as hidden: `currentState` is undefined before the first
  // event and can be `unknown`, and a prompt withheld on a guess would let a waiting assistant expire.
  const [hidden, setHidden] = useState(AppState.currentState === 'background');

  useEffect(() => {
    const subscription = AppState.addEventListener('change', next => setHidden(next === 'background'));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!enabled || open.current || hidden) return;
    const next = (pending ?? []).find(p => p.id !== prompted.current);
    if (!next) return;
    open.current = true;
    prompted.current = next.id;
    const answer = (allow: boolean, lifetimeMs = 0) => {
      open.current = false;
      onAnswer(next.id, allow, lifetimeMs);
    };
    Alert.alert(
      t('mcpAuth.title', { client: next.clientName }),
      t('mcpAuth.body', { client: next.clientName, host: next.host, code: next.code }),
      [
        { text: t('mcpAuth.deny'), style: 'cancel', onPress: () => answer(false) },
        { text: t('mcpAuth.allowDay'), onPress: () => answer(true, GRANT_DAY_MS) },
        { text: t('mcpAuth.allow'), onPress: () => answer(true) },
      ],
      { cancelable: false },
    );
  }, [enabled, pending, hidden, onAnswer]);

  return null;
}
