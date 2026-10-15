import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { color, font } from '../theme';
import { useAppState } from '../state/AppStateContext';
import {
  CONTROL_TOOLS, controlAvailability, PROMPTS, READ_TOOLS, RESOURCE_URIS, RESOURCES, TOOL_PREFIX,
} from '../surveillance/mcpServices';
import { formatWhen } from '../utils/date';
import { Sheet } from './Sheet';
import { StringKey, t } from '../i18n';

/**
 * Everything the MCP server offers, in the owner's words.
 *
 * The control section says whether an agent can drive the camera *now* and,
 * if not, the one thing in the way: a page that listed six control tools under
 * a switch that is off would describe a power the agent does not have.
 */
export function McpServicesSheet() {
  const { info, closeInfo, settings, mcpStatus } = useAppState();
  const open = info === 'mcp';
  const availability = controlAvailability(settings, Date.now());
  const controlLine = availability !== 'available'
    ? t(`mcpService.control.${availability}`)
    : settings.mcpControlExpiresAt > 0
      ? t('mcpService.control.availableUntil', { time: formatWhen(settings.mcpControlExpiresAt) })
      : t('mcpService.control.available');

  return (
    <Sheet visible={open} onClose={closeInfo} maxHeightPercent={88}>
      <Text style={styles.title}>{t('mcpService.title')}</Text>
      <Text style={styles.intro}>{t('mcpService.intro')}</Text>
      <Text style={[styles.status, mcpStatus.running ? styles.on : styles.off]} testID="mcp-services-status">
        {mcpStatus.running && mcpStatus.url
          ? t('mcpService.status.running', { url: mcpStatus.url })
          : t('mcpService.status.stopped')}
      </Text>

      <Section title={t('mcpService.section.read')} note={t('mcpService.section.read.sub')}>
        {READ_TOOLS.map(name => (
          <Service key={name} name={TOOL_PREFIX + name} description={t(`mcpService.tool.${name}`)} />
        ))}
      </Section>

      <Section
        title={t('mcpService.section.control')}
        note={controlLine}
        noteStyle={availability === 'available' ? styles.on : styles.off}
        testID="mcp-services-control"
      >
        {CONTROL_TOOLS.map(name => (
          <Service
            key={name}
            name={TOOL_PREFIX + name}
            description={t(`mcpService.tool.${name}`)}
            dimmed={availability !== 'available'}
          />
        ))}
      </Section>

      <Section title={t('mcpService.section.prompts')} note={t('mcpService.section.prompts.sub')}>
        {PROMPTS.map(name => (
          <Service key={name} name={name} description={t(`mcpService.prompt.${name}`)} />
        ))}
      </Section>

      <Section title={t('mcpService.section.resources')}>
        {RESOURCES.map(name => (
          <Service key={name} name={RESOURCE_URIS[name]} description={t(`mcpService.resource.${name}` as StringKey)} />
        ))}
      </Section>

      <Section title={t('mcpService.section.never')}>
        <Text style={styles.body}>{t('mcpService.never')}</Text>
      </Section>

      <Text style={styles.footer}>{t('setup.mcpPrivacyNote')}</Text>
    </Sheet>
  );
}

function Section({ title, note, noteStyle, testID, children }: {
  title: string; note?: string; noteStyle?: object; testID?: string; children: React.ReactNode;
}) {
  return (
    <View style={styles.card} testID={testID}>
      <Text style={styles.cardTitle} accessibilityRole="header">{title}</Text>
      {note ? <Text style={[styles.note, noteStyle]}>{note}</Text> : null}
      <View style={styles.rows}>{children}</View>
    </View>
  );
}

function Service({ name, description, dimmed = false }: { name: string; description: string; dimmed?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.name, dimmed && styles.dimmed]}>{name}</Text>
      <Text style={[styles.body, dimmed && styles.dimmed]}>{description}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  title: {
    fontFamily: font.semibold,
    fontSize: 17,
    color: color.text,
    marginBottom: 6,
  },
  intro: {
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 17,
    color: color.neutral500,
    marginBottom: 8,
  },
  status: {
    fontFamily: font.medium,
    fontSize: 12,
    marginBottom: 14,
  },
  on: {
    color: color.accent,
  },
  off: {
    color: color.warning,
  },
  card: {
    backgroundColor: color.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: color.divider,
    padding: 12,
    marginBottom: 10,
  },
  cardTitle: {
    fontFamily: font.semibold,
    fontSize: 13,
    color: color.text,
  },
  note: {
    fontFamily: font.regular,
    fontSize: 11,
    lineHeight: 15,
    color: color.neutral500,
    marginTop: 4,
  },
  rows: {
    marginTop: 10,
    gap: 10,
  },
  row: {
    gap: 2,
  },
  name: {
    fontFamily: 'monospace',
    fontSize: 12,
    color: color.accent,
  },
  body: {
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 17,
    color: color.neutral400,
  },
  dimmed: {
    color: color.neutral600,
  },
  footer: {
    fontFamily: font.regular,
    fontSize: 10,
    lineHeight: 14,
    color: color.neutral600,
    marginTop: 2,
    marginBottom: 6,
  },
});
