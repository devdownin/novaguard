import { Alert } from 'react-native';
import { t } from '../i18n';

/**
 * The question asked before the phone is allowed to dial out: it names the relay and says
 * what a relay is able to see. Asked wherever the switch can be reached from — Réglages and
 * the connection sheet — so the wording, and what it promises, cannot differ between them.
 */
export function askCloudConsent(host: string, onAccept: () => void): void {
  Alert.alert(
    t('setup.mcpCloud.consent.title'),
    t('setup.mcpCloud.consent.body', { host }),
    [
      { text: t('setup.mcpCloud.consent.cancel'), style: 'cancel' },
      { text: t('setup.mcpCloud.consent.accept'), onPress: onAccept },
    ],
  );
}
