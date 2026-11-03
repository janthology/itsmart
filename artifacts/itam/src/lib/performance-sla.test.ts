import { describe, expect, it } from "vitest";
import { getPerformanceSLA, summarizePerformanceSLA } from "./performance-sla";
import { computeSLA } from "./sla";

const createdAt = "2026-01-01T00:00:00.000Z";
const resolved = {
  priority: "high",
  status: "resolved",
  createdAt,
  resolvedAt: "2026-01-01T10:00:00.000Z",
  totalHoldSeconds: 4 * 3600,
};

describe("resolution performance SLA", () => {
  it("matches the ticket badge when time on hold makes a difference", () => {
    const report = getPerformanceSLA(resolved);
    const badge = computeSLA(resolved.priority, createdAt, resolved.resolvedAt, resolved.status, resolved.totalHoldSeconds);
    expect(report).toEqual({ status: "Met", targetHours: 8, resolutionHours: 6 });
    expect(badge.status).toBe("met");
    expect(report.resolutionHours).toBe(badge.elapsedHours);
  });

  it("uses unrounded active hours to classify a boundary breach", () => {
    const justLate = { ...resolved, resolvedAt: "2026-01-01T08:00:10.000Z", totalHoldSeconds: 0 };
    expect(getPerformanceSLA(justLate)).toEqual({ status: "Breached", targetHours: 8, resolutionHours: 8 });
    expect(summarizePerformanceSLA([justLate])).toEqual({ met: 0, breached: 1, pending: 0, closedWithoutResolution: 0 });
    expect(getPerformanceSLA({ ...justLate, resolvedAt: "2026-01-01T08:00:00.000Z" }).status).toBe("Met");
  });

  it("uses resolution rather than closure time for a resolved-then-closed ticket", () => {
    expect(getPerformanceSLA({ ...resolved, status: "closed" })).toEqual({ status: "Met", targetHours: 8, resolutionHours: 6 });
  });

  it("counts direct closures separately and leaves active tickets pending", () => {
    const directlyClosed = { ...resolved, status: "closed", resolvedAt: null };
    const active = { ...resolved, status: "on_hold", resolvedAt: null };
    expect(getPerformanceSLA(directlyClosed)).toEqual({ status: "Closed without resolution", targetHours: 8, resolutionHours: null });
    expect(getPerformanceSLA(active)).toEqual({ status: "Pending", targetHours: 8, resolutionHours: null });
    expect(summarizePerformanceSLA([resolved, directlyClosed, active])).toEqual({ met: 1, breached: 0, pending: 1, closedWithoutResolution: 1 });
  });

  it("does not treat stale resolution timestamps on active tickets as completed resolutions", () => {
    expect(getPerformanceSLA({ ...resolved, status: "in_progress" }).status).toBe("Pending");
    expect(getPerformanceSLA({ ...resolved, status: "on_hold" }).resolutionHours).toBeNull();
  });

  it("handles missing hold data and uses the shared target fallback", () => {
    expect(getPerformanceSLA({ ...resolved, totalHoldSeconds: null }).status).toBe("Breached");
    expect(getPerformanceSLA({ ...resolved, priority: "unknown" }).targetHours).toBe(24);
  });
});
