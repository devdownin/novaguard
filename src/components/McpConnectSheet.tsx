import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { color, font, MAX_FONT_SCALE } from '../theme';
import { useAppState } from '../state/AppStateContext';
import {
  AgentId, agentName, agentsFor, baselineOf, Baseline, blocker, controlOffered, Fix, grantSubtitle, howKey, isCloudAgent, payloadFor, progress, Where, WHERE,
} from '../surveillance/mcpConnect';
import { normalizeRelayUrl, relayHostOf } from '../surveillance/relayAddress';
import { PrimaryOutlineButton, SecondaryOutlineButton } from './OutlineButton';
import { Sheet } from './Sheet';
import { ValueButton } from './SetupRows';
import { askCloudConsent } from './cloudConsent';
import { copyText } from '../utils/clipboard';
import { formatWhen } from '../utils/date';
import type { TokenChoice } from '../surveillance/mcpClients';
import { LastChoice, loadLast, saveLast } from '../surveillance/connectMemory';
import { isTermuxInstalled, McpSelfTest, selfTestMcpServer } from '../surveillance/mcpServer';
import { QrCode } from './QrCode';
import { StringKey, t } from '../i18n';

/**
 * "Connecter un assistant": where it runs, which one, then what to copy — and proof.
 *
 * The page used to be a flat list of a port, a token, a certificate and four buttons, and it
 * asked the owner to know what each was for. Here they answer two questions, copy one thing,
 * and watch the phone say it has seen the assistant. When something is in the way, the
 * screen names that one thing and offers the button that clears it.
 */
export function McpConnectSheet() {
  const s = useAppState();
  const open = s.info === 'connect';
  const { settings, mcpStatus } = s;

  const [where, setWhere] = React.useState<Where | null>(null);
  const [agent, setAgent] = React.useState<AgentId | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [access, setAccess] = React.useState<TokenChoice>('read');
  const [last, setLast] = React.useState<LastChoice | null>(null);
  const [termux, setTermux] = React.useState(false);
  const [editingRelay, setEditingRelay] = React.useState(false);
  const [relayText, setRelayText] = React.useState('');
  const [relayInvalid, setRelayInvalid] = React.useState(false);
  const baseline = React.useRef<Baseline>(baselineOf(mcpStatus));

  // Every opening starts from the question, not from wherever the last one stopped.
  React.useEffect(() => {
    if (!open) return;
    setWhere(null); setAgent(null); setCopied(false); setAccess('read'); setEditingRelay(false); setRelayInvalid(false);
    let current = true;
    loadLast().then(found => { if (current) setLast(found); });
    isTermuxInstalled().then(found => { if (current) setTermux(found); });
    return () => { current = false; };
  }, [open]);

  // What was connected is what to offer next time, once an assistant's own screen has been reached.
  React.useEffect(() => {
    if (open && where && agent) saveLast({ where, agent, access });
  }, [open, where, agent, access]);

  // Proof is measured from the moment the assistant's own screen appears.
  React.useEffect(() => {
    if (agent) baseline.current = baselineOf(mcpStatus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent]);

  const back = () => {
    if (agent) { setAgent(null); setCopied(false); setEditingRelay(false); } else setWhere(null);
  };

  const relayAddress = normalizeRelayUrl(settings.mcpRelayUrl);
  const fix = (action: Fix) => {
    switch (action) {
      case 'enableServer': return s.toggleMcpServer();
      case 'generateToken': return s.generateMcpToken();
      case 'enableCloud': return relayAddress ? askCloudConsent(relayHostOf(relayAddress), s.toggleMcpCloud) : undefined;
      case 'setRelay': return saveRelay();
    }
  };
  const saveRelay = () => {
    const accepted = s.setMcpRelayUrl(relayText);
    setRelayInvalid(!accepted);
    if (accepted) setEditingRelay(false);
  };

  return (
    <Sheet visible={open} onClose={s.closeInfo} maxHeightPercent={88}>
      <Text style={styles.title} accessibilityRole="header">{t('connect.title')}</Text>
      {where === null ? (
        <WhereStep
          onPick={setWhere}
          termux={termux}
          last={last}
          onResume={choice => { setWhere(choice.where); setAgent(choice.agent); setAccess(choice.access); }}
        />
      ) : agent === null ? (
        <AgentStep where={where} onPick={setAgent} onBack={back} />
      ) : (
        <ConnectStep
          where={where}
          agent={agent}
          copied={copied}
          access={access}
          onAccess={setAccess}
          onCopied={() => setCopied(true)}
          baseline={baseline.current}
          onFix={fix}
          editingRelay={editingRelay || (isCloudAgent(agent) && !relayAddress)}
          onEditRelay={() => { setRelayText(settings.mcpRelayUrl); setRelayInvalid(false); setEditingRelay(true); }}
          relayText={relayText}
          onRelayText={text => { setRelayText(text); setRelayInvalid(false); }}
          relayInvalid={relayInvalid}
          onBack={back}
        />
      )}
      <SecondaryOutlineButton label={t('connect.close')} onPress={s.closeInfo} style={styles.close} />
    </Sheet>
  );
}

// ------------------------------------------------------------------ 1. where

function WhereStep({ onPick, termux, last, onResume }: {
  onPick: (where: Where) => void;
  termux: boolean;
  last: LastChoice | null;
  onResume: (choice: LastChoice) => void;
}) {
  const { mcpStatus, revokeMcpGrant } = useAppState();
  const grants = mcpStatus.grants ?? [];
  return (
    <View>
      {last ? (
        <Choice
          title={t('connect.resume', {
            agent: agentName(last.agent) ?? t('connect.agent.json'),
            where: t(`connect.where.${last.where}`),
          })}
          onPress={() => onResume(last)}
        />
      ) : null}
      <Text style={styles.question}>{t('connect.where.title')}</Text>
      {WHERE.map(where => (
        <Choice
          key={where}
          title={t(`connect.where.${where}`)}
          sub={where === 'phone' && termux ? t('connect.where.phone.termux') : t(`connect.where.${where}.sub` as StringKey)}
          onPress={() => onPick(where)}
        />
      ))}
      {grants.length > 0 ? (
        <View style={styles.card} testID="connect-grants">
          <Text style={styles.label}>{t('connect.grants.title')}</Text>
          {grants.map(grant => (
            <View key={grant.id} style={styles.grant}>
              <View style={styles.grantText}>
                <Text style={styles.body}>{grant.clientName}</Text>
                <Text style={styles.hint}>{grantSubtitle(grant)}</Text>
              </View>
              <ValueButton
                label={t('setup.mcpGrants.revoke')}
                accessibilityLabel={t('setup.mcpGrants.revoke.a11y', { client: grant.clientName })}
                onPress={() => revokeMcpGrant(grant.id)}
              />
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

// ------------------------------------------------------------------ 2. which

function AgentStep({ where, onPick, onBack }: { where: Where; onPick: (agent: AgentId) => void; onBack: () => void }) {
  return (
    <View>
      <Text style={styles.question}>{t('connect.agent.title')}</Text>
      {agentsFor(where).map(agent => (
        <Choice key={agent} title={agentName(agent) ?? t('connect.agent.json')} onPress={() => onPick(agent)} />
      ))}
      <SecondaryOutlineButton label={t('connect.back')} onPress={onBack} style={styles.back} />
    </View>
  );
}

// ------------------------------------------------------------------ 3. connect, and see it work

interface ConnectProps {
  where: Where;
  agent: AgentId;
  copied: boolean;
  access: TokenChoice;
  onAccess: (access: TokenChoice) => void;
  onCopied: () => void;
  baseline: Baseline;
  onFix: (fix: Fix) => void;
  editingRelay: boolean;
  onEditRelay: () => void;
  relayText: string;
  onRelayText: (text: string) => void;
  relayInvalid: boolean;
  onBack: () => void;
}

function ConnectStep(p: ConnectProps) {
  const { settings, mcpStatus } = useAppState();
  const cloud = isCloudAgent(p.agent);
  const stop = blocker(p.where, settings, mcpStatus);
  const canControl = controlOffered(settings, Date.now());
  // A choice made while control was on must not outlive it: fall back to reading rather than copy a dead token.
  const access: TokenChoice = canControl ? p.access : 'read';
  const payload = stop ? null : payloadFor(p.agent, p.where, settings, mcpStatus, access);
  const seen = progress(p.baseline, mcpStatus);
  const [test, setTest] = React.useState<McpSelfTest | null>(null);
  const [showQr, setShowQr] = React.useState(false);
  const relayHost = relayHostOf(normalizeRelayUrl(settings.mcpRelayUrl) ?? '');

  return (
    <View>
      <Text style={styles.question}>{agentName(p.agent) ?? t('connect.agent.json')}</Text>

      {cloud && !stop && relayHost ? <RelayDiagram host={relayHost} /> : null}

      {stop ? (
        <View style={styles.card} testID="connect-blocker">
          <Text style={[styles.body, stop.waiting ? styles.calm : styles.warn]}>{t(stop.key)}</Text>
          {stop.fix && stop.fix !== 'setRelay' ? (
            <PrimaryOutlineButton label={t(`connect.fix.${stop.fix}`)} onPress={() => p.onFix(stop.fix!)} style={styles.action} />
          ) : null}
        </View>
      ) : null}

      {cloud && p.editingRelay ? (
        <View style={styles.card} testID="connect-relay">
          <Text style={styles.label}>{t('connect.relay.label')}</Text>
          <TextInput
            value={p.relayText}
            onChangeText={p.onRelayText}
            placeholder="https://"
            placeholderTextColor={color.neutral500}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            accessibilityLabel={t('connect.relay.label')}
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            style={styles.input}
          />
          <Text style={[styles.hint, p.relayInvalid && styles.warn]}>
            {p.relayInvalid ? t('connect.relay.invalid') : t('connect.relay.hint')}
          </Text>
          <PrimaryOutlineButton label={t('connect.fix.setRelay')} onPress={() => p.onFix('setRelay')} style={styles.action} />
        </View>
      ) : null}

      {p.where === 'phone' ? <Text style={styles.hint}>{t('connect.phone.hint')}</Text> : null}
      {cloud ? (
        <Text style={styles.hint}>{t('connect.access.cloud')}</Text>
      ) : (
        <View style={styles.card} testID="connect-access">
          <Text style={styles.label}>{t('connect.access.title')}</Text>
          <Radio
            title={t('connect.access.read')}
            sub={t('connect.access.read.sub')}
            selected={access === 'read'}
            onPress={() => p.onAccess('read')}
          />
          <Radio
            title={t('connect.access.control')}
            sub={canControl ? t('connect.access.control.sub') : t('connect.access.control.off')}
            selected={access === 'control'}
            disabled={!canControl}
            onPress={() => p.onAccess('control')}
          />
        </View>
      )}

      {payload ? (
        <View style={styles.card}>
          <Text style={styles.body}>{t(howKey(p.agent))}</Text>
          <Text style={styles.code} selectable testID="connect-payload">{payload.text}</Text>
          <PrimaryOutlineButton
            label={p.copied ? t('setup.mcpCopy.copied') : t(copyLabel(p.agent, payload.isConfiguration))}
            onPress={() => { copyText(payload.text); p.onCopied(); }}
            style={styles.action}
          />
          {p.where !== 'phone' ? (
            <>
              <SecondaryOutlineButton
                label={t(showQr ? 'setup.mcpQr.hide' : 'setup.mcpQr.show')}
                onPress={() => setShowQr(v => !v)}
                style={styles.action}
              />
              {showQr ? (
                <View style={styles.qr}>
                  <QrCode value={payload.text} size={200} accessibilityLabel={t('setup.mcpQr.label')} />
                  {payload.isConfiguration ? <Text style={styles.hint}>{t('setup.mcpQr.hint')}</Text> : null}
                </View>
              ) : null}
            </>
          ) : null}
          <SecondaryOutlineButton
            label={t('connect.test.run')}
            onPress={() => { selfTestMcpServer().then(setTest); }}
            style={styles.action}
          />
          {test ? (
            <Text style={[styles.hint, !test.ok && styles.warn]} accessibilityLiveRegion="polite" testID="connect-test">
              {test.ok ? t('connect.test.ok', { tools: test.tools, ms: Math.max(1, Math.round(test.ms)) }) : t('connect.test.fail')}
            </Text>
          ) : null}
          <Text
            style={[styles.progress, seen === 'connected' && styles.connected]}
            accessibilityLiveRegion="polite"
            testID="connect-progress"
          >
            {seen === 'connected'
              ? t('connect.progress.connected', { time: formatWhen(mcpStatus.lastActivityAt ?? Date.now()) })
              : t(`connect.progress.${seen}`)}
          </Text>
        </View>
      ) : null}

      {cloud && !p.editingRelay && settings.mcpRelayUrl ? (
        <SecondaryOutlineButton label={t('connect.relay.change')} onPress={p.onEditRelay} style={styles.back} />
      ) : null}
      <SecondaryOutlineButton label={t('connect.back')} onPress={p.onBack} style={styles.back} />
    </View>
  );
}

function copyLabel(agent: AgentId, isConfiguration: boolean): StringKey {
  if (!isConfiguration) return 'connect.copy.address';
  return agent === 'claude-code' || agent === 'openclaw' ? 'connect.copy.command' : 'connect.copy.config';
}

// ------------------------------------------------------------------ what the cloud path is

/** Who talks to whom, drawn plainly: the relay is the one part of this chain the owner does not run. */
function RelayDiagram({ host }: { host: string }) {
  const steps = [t('connect.diagram.assistant'), t('connect.diagram.relay'), t('connect.diagram.phone')];
  return (
    <View style={styles.card} accessible accessibilityLabel={`${t('connect.diagram.a11y', { host })} ${t('connect.diagram.note')}`}>
      <View style={styles.diagram}>
        {steps.map((step, index) => (
          <React.Fragment key={step}>
            {index > 0 ? <Text style={styles.arrow}>→</Text> : null}
            <View style={[styles.node, index === 1 && styles.relayNode]}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.nodeText}>{step}</Text>
              {index === 1 ? <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.nodeHost}>{host}</Text> : null}
            </View>
          </React.Fragment>
        ))}
      </View>
      <Text style={styles.hint}>{t('connect.diagram.note')}</Text>
    </View>
  );
}

// ------------------------------------------------------------------ a choice

/** A large target with its explanation, because a one-word button cannot say where "cloud" goes. */
function Choice({ title, sub, onPress }: { title: string; sub?: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={sub ? `${title}. ${sub}` : title}
      style={({ pressed }) => [styles.choice, pressed && styles.pressed]}
    >
      <ChoiceText title={title} sub={sub} />
    </Pressable>
  );
}

/** One of two exclusive options; a radio for a screen reader, which a button is not. */
function Radio({ title, sub, selected, disabled, onPress }: {
  title: string; sub: string; selected: boolean; disabled?: boolean; onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled: !!disabled }}
      accessibilityLabel={`${title}. ${sub}`}
      style={({ pressed }) => [styles.choice, selected && styles.selected, disabled && styles.disabled, pressed && styles.pressed]}
    >
      <ChoiceText title={title} sub={sub} />
    </Pressable>
  );
}

function ChoiceText({ title, sub }: { title: string; sub?: string }) {
  return (
    <>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.choiceTitle}>{title}</Text>
      {sub ? <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.choiceSub}>{sub}</Text> : null}
    </>
  );
}

const styles = StyleSheet.create({
  title: { fontFamily: font.semibold, fontSize: 17, color: color.text, marginBottom: 10 },
  question: { fontFamily: font.semibold, fontSize: 14, color: color.text, marginBottom: 10 },
  choice: {
    backgroundColor: color.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: color.divider,
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  pressed: { opacity: 0.62 },
  selected: { borderColor: color.accent },
  disabled: { opacity: 0.5 },
  qr: { alignItems: 'center', marginTop: 10 },
  diagram: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  arrow: { fontFamily: font.regular, fontSize: 16, color: color.neutral500, paddingHorizontal: 4 },
  node: { flex: 1, borderWidth: 1, borderColor: color.divider, borderRadius: 8, padding: 6, alignItems: 'center' },
  relayNode: { borderColor: color.warning },
  nodeText: { fontFamily: font.medium, fontSize: 11, color: color.text, textAlign: 'center' },
  nodeHost: { fontFamily: font.regular, fontSize: 10, color: color.neutral500, textAlign: 'center' },
  grant: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  grantText: { flex: 1, paddingRight: 8 },
  choiceTitle: { fontFamily: font.medium, fontSize: 14, color: color.text },
  choiceSub: { fontFamily: font.regular, fontSize: 12, lineHeight: 17, color: color.neutral500, marginTop: 3 },
  card: {
    backgroundColor: color.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: color.divider,
    padding: 12,
    marginBottom: 10,
  },
  body: { fontFamily: font.regular, fontSize: 13, lineHeight: 18, color: color.text },
  calm: { color: color.neutral500 },
  warn: { color: color.warning },
  label: { fontFamily: font.medium, fontSize: 12, color: color.text, marginBottom: 6 },
  hint: { fontFamily: font.regular, fontSize: 11, lineHeight: 16, color: color.neutral500, marginTop: 6 },
  input: {
    fontFamily: font.regular,
    fontSize: 13,
    color: color.text,
    borderWidth: 1,
    borderColor: color.divider,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  code: {
    fontFamily: font.regular,
    fontSize: 11,
    lineHeight: 16,
    color: color.text,
    backgroundColor: color.bg,
    borderRadius: 8,
    padding: 10,
    marginTop: 10,
  },
  action: { marginTop: 10 },
  progress: { fontFamily: font.medium, fontSize: 12, color: color.neutral500, marginTop: 12 },
  connected: { color: color.accent },
  back: { marginTop: 4 },
  close: { marginTop: 10 },
});
