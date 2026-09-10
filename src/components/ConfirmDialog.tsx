import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { color, font, radius, shadow } from '../theme';
import { t } from '../i18n';

interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  body: string;
  cancelLabel?: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({
  visible, title, body, cancelLabel = t('confirm.cancel'), confirmLabel, onCancel, onConfirm,
}: ConfirmDialogProps) {
  if (!visible) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <View style={styles.backdrop}>
        <View style={styles.dialog}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.body}>{body}</Text>
          <View style={styles.actions}>
            {/* Both had neither a role nor a pressed state: announced to
                TalkBack as text, so the "next control" gesture never reached
                them — on the dialog that stands between the user and a
                deletion. */}
            <Pressable
              onPress={onCancel}
              accessibilityRole="button"
              style={({ pressed }) => [styles.cancelBtn, pressed && { opacity: 0.62 }]}
            >
              <Text style={styles.cancelText}>{cancelLabel}</Text>
            </Pressable>
            <Pressable
              onPress={onConfirm}
              accessibilityRole="button"
              style={({ pressed }) => [styles.confirmBtn, pressed && { opacity: 0.62 }]}
            >
              <Text style={styles.confirmText}>{confirmLabel}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 26,
    backgroundColor: 'rgba(10,11,18,0.72)',
  },
  dialog: {
    width: '100%',
    padding: 18,
    borderRadius: radius.lg,
    backgroundColor: color.surface,
    ...shadow.lg,
  },
  title: {
    fontFamily: font.medium,
    fontSize: 16,
    color: color.text,
    marginBottom: 6,
  },
  body: {
    fontFamily: font.regular,
    fontSize: 12.5,
    lineHeight: 18.75,
    color: color.neutral400,
  },
  actions: {
    flexDirection: 'row',
    gap: 7,
    marginTop: 16,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: color.neutral800,
    alignItems: 'center',
  },
  cancelText: {
    fontFamily: font.regular,
    fontSize: 12.5,
    color: color.neutral200,
  },
  confirmBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: color.accent,
    backgroundColor: color.accent900,
    alignItems: 'center',
  },
  confirmText: {
    fontFamily: font.medium,
    fontSize: 12.5,
    color: color.accent200,
  },
});
