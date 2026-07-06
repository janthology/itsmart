// SLA resolution targets in hours, by priority
export const SLA_HOURS: Record<string, number> = {
  critical: 4,
  high: 8,
  medium: 24,
  low: 72,
};

export type SLAStatus = 'met' | 'at_risk' | 'breached' | 'paused' | 'pending';

export interface SLAInfo {
  targetHours: number;
  deadlineAt: Date;
  /** active elapsed hours (excluding hold time) */
  elapsedHours: number;
  remainingHours: number;
  status: SLAStatus;
  label: string;
  percentUsed: number;
}

function formatHours(hours: number): string {
  const abs = Math.abs(hours);
  if (abs < 1) {
    const mins = Math.round(abs * 60);
    return `${mins}m`;
  }
  const h = Math.floor(abs);
  const m = Math.round((abs - h) * 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/**
 * Compute SLA info for a ticket, pausing the clock while on_hold.
 *
 * @param priority         ticket priority
 * @param createdAt        ISO string
 * @param resolvedAt       ISO string or null
 * @param ticketStatus     current ticket status
 * @param totalHoldSeconds total seconds the ticket has been on hold (accumulated)
 * @param onHoldAt         ISO string — when the current hold period started (null if not on hold)
 */
export function computeSLA(
  priority: string,
  createdAt: string,
  resolvedAt: string | null | undefined,
  ticketStatus: string,
  totalHoldSeconds = 0,
  onHoldAt: string | null | undefined = null,
  closedAt: string | null | undefined = null,
): SLAInfo {
  const targetHours = SLA_HOURS[priority] ?? 24;
  const created = new Date(createdAt);

  // Use resolvedAt first, then closedAt, then now() for active tickets
  const terminalTime = resolvedAt ?? closedAt;
  const referenceTime = terminalTime ? new Date(terminalTime) : new Date();
  const totalElapsedMs = referenceTime.getTime() - created.getTime();

  // Accumulate current hold period if still on hold
  let holdMs = totalHoldSeconds * 1000;
  if (ticketStatus === 'on_hold' && onHoldAt) {
    holdMs += referenceTime.getTime() - new Date(onHoldAt).getTime();
  }

  const activeElapsedMs = Math.max(totalElapsedMs - holdMs, 0);
  const elapsedHours = activeElapsedMs / (1000 * 60 * 60);
  const remainingHours = targetHours - elapsedHours;
  const percentUsed = Math.min(Math.round((elapsedHours / targetHours) * 100), 999);

  // Deadline shifts forward by hold time
  const deadlineAt = new Date(created.getTime() + targetHours * 60 * 60 * 1000 + holdMs);

  const isTerminal = ticketStatus === 'resolved' || ticketStatus === 'closed';
  const isOnHold = ticketStatus === 'on_hold';

  let status: SLAStatus;
  if (isTerminal) {
    status = remainingHours >= 0 ? 'met' : 'breached';
  } else if (isOnHold) {
    status = 'paused';
  } else if (remainingHours < 0) {
    status = 'breached';
  } else if (percentUsed >= 75) {
    status = 'at_risk';
  } else {
    status = 'pending';
  }

  let label: string;
  if (isTerminal) {
    label = status === 'met'
      ? `Resolved in ${formatHours(elapsedHours)}`
      : `Breached by ${formatHours(-remainingHours)}`;
  } else if (isOnHold) {
    label = '⏸ Paused (on hold)';
  } else if (status === 'breached') {
    label = `Overdue by ${formatHours(-remainingHours)}`;
  } else {
    label = `${formatHours(remainingHours)} remaining`;
  }

  return { targetHours, deadlineAt, elapsedHours, remainingHours, status, label, percentUsed };
}
