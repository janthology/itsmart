import { describe, it, expect, vi } from "vitest";
import { computeSLA, SLA_HOURS } from "./sla";

const created = "2026-01-01T00:00:00.000Z";

describe("SLA_HOURS targets", () => {
  it("matches the agreed resolution targets", () => {
    expect(SLA_HOURS).toEqual({ critical: 4, high: 8, medium: 24, low: 72 });
  });
});

describe("computeSLA", () => {
  it("marks a ticket resolved within target as met", () => {
    // critical = 4h; resolved after 2h
    const info = computeSLA("critical", created, "2026-01-01T02:00:00.000Z", "resolved");
    expect(info.status).toBe("met");
    expect(info.targetHours).toBe(4);
    expect(info.elapsedHours).toBeCloseTo(2);
    expect(info.label).toContain("Resolved in");
  });

  it("marks a ticket resolved after target as breached", () => {
    // low = 72h; resolved after 100h
    const info = computeSLA("low", created, "2026-01-05T04:00:00.000Z", "resolved");
    expect(info.status).toBe("breached");
    expect(info.label).toContain("Breached by");
  });

  it("excludes accumulated hold time from the elapsed clock", () => {
    // high = 8h; resolved after 10h wall-clock but 4h was on hold -> 6h active
    const info = computeSLA(
      "high",
      created,
      "2026-01-01T10:00:00.000Z",
      "resolved",
      4 * 3600
    );
    expect(info.status).toBe("met");
    expect(info.elapsedHours).toBeCloseTo(6);
  });

  it("pauses while currently on hold", () => {
    const info = computeSLA("medium", created, null, "on_hold", 0, created);
    expect(info.status).toBe("paused");
  });

  it("retains pending, at-risk and breached states for open tickets", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T05:00:00.000Z"));
      expect(computeSLA("high", created, null, "open").status).toBe("pending");
      vi.setSystemTime(new Date("2026-01-01T06:00:00.000Z"));
      expect(computeSLA("high", created, null, "in_progress").status).toBe("at_risk");
      vi.setSystemTime(new Date("2026-01-01T09:00:00.000Z"));
      expect(computeSLA("high", created, null, "in_progress").status).toBe("breached");
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks direct closure as not applicable, regardless of close time", () => {
    for (const closedAt of ["2026-01-01T01:00:00.000Z", "2026-01-02T06:00:00.000Z", null]) {
      const info = computeSLA("medium", created, null, "closed", 0, null, closedAt);
      expect(info.status).toBe("not_applicable");
      expect(info.label).toBe("Closed without resolution");
    }
  });

  it("keeps the resolution SLA outcome after a resolved ticket is closed", () => {
    const info = computeSLA("high", created, "2026-01-01T10:00:00.000Z", "closed", 4 * 3600, null, "2026-01-08T10:00:00.000Z");
    expect(info.status).toBe("met");
    expect(info.elapsedHours).toBe(6);
  });

  it("falls back to a 24h target for unknown priorities", () => {
    const info = computeSLA("unknown", created, "2026-01-01T01:00:00.000Z", "resolved");
    expect(info.targetHours).toBe(24);
  });
});
