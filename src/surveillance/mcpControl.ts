import type { ControlLifetime, Settings } from '../state/types';

/**
 * How long a control token works once issued.
 *
 * Handing a camera to an agent for one night should not mean handing it over
 * for good: a token copied into a client config outlives the reason it was
 * copied. The native server enforces the end (`McpRules.controlLive`), so a
 * JavaScript side that is asleep or killed cannot extend it.
 */
export const CONTROL_LIFETIMES: readonly ControlLifetime[] = ['1 h', '24 h', 'Toujours'];

const LIFETIME_MS: Record<ControlLifetime, number> = {
  '1 h': 3_600_000,
  '24 h': 86_400_000,
  Toujours: 0,
};

export function nextLifetime(current: ControlLifetime): ControlLifetime {
  return CONTROL_LIFETIMES[(CONTROL_LIFETIMES.indexOf(current) + 1) % CONTROL_LIFETIMES.length];
}

/** Epoch ms the token stops working, or 0 for never. */
export function controlExpiry(lifetime: ControlLifetime, now: number): number {
  const ms = LIFETIME_MS[lifetime];
  return ms > 0 ? now + ms : 0;
}

/** Same rule as `McpRules.controlLive`. */
export function controlLive(expiresAt: number, now: number): boolean {
  return expiresAt <= 0 || now < expiresAt;
}

/** Whether an agent may drive the camera right now. */
export function agentControlLive(settings: Settings, now: number): boolean {
  return settings.mcpEnabled
    && settings.mcpControlEnabled
    && settings.mcpControlToken.length > 0
    && controlLive(settings.mcpControlExpiresAt, now);
}
