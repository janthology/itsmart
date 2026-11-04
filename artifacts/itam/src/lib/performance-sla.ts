import { computeSLA, isClosedWithoutResolution, SLA_HOURS } from "./sla";

/** The resolution report deliberately keeps active tickets pending, even if
 * their live SLA badge is at risk or breached. Direct closures are not
 * resolutions and are counted separately from SLA outcomes. */
export type PerformanceSLAStatus = "Met" | "Breached" | "Pending" | "Closed without resolution";

export interface PerformanceSLATicket {
  priority: string;
  status: string;
  createdAt: string;
  resolvedAt?: string | null;
  totalHoldSeconds?: number | null;
}

export interface PerformanceSLA {
  status: PerformanceSLAStatus;
  targetHours: number;
  /** Active resolution hours, rounded for display only; null if not resolved. */
  resolutionHours: number | null;
}

export function getPerformanceSLA(ticket: PerformanceSLATicket): PerformanceSLA {
  const targetHours = SLA_HOURS[ticket.priority] ?? 24;
  if (isClosedWithoutResolution(ticket.status, ticket.resolvedAt)) {
    return { status: "Closed without resolution", targetHours, resolutionHours: null };
  }
  if (!ticket.resolvedAt || (ticket.status !== "resolved" && ticket.status !== "closed")) {
    return { status: "Pending", targetHours, resolutionHours: null };
  }

  const sla = computeSLA(ticket.priority, ticket.createdAt, ticket.resolvedAt, ticket.status, ticket.totalHoldSeconds ?? 0);
  return {
    status: sla.status === "met" ? "Met" : "Breached",
    targetHours: sla.targetHours,
    resolutionHours: Number(sla.elapsedHours.toFixed(2)),
  };
}

export function summarizePerformanceSLA(tickets: PerformanceSLATicket[]) {
  const counts = { met: 0, breached: 0, pending: 0, closedWithoutResolution: 0 };
  for (const ticket of tickets) {
    switch (getPerformanceSLA(ticket).status) {
      case "Met": counts.met++; break;
      case "Breached": counts.breached++; break;
      case "Pending": counts.pending++; break;
      case "Closed without resolution": counts.closedWithoutResolution++; break;
    }
  }
  return counts;
}
