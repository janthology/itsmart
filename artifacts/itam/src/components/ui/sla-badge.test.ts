import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SLABadge } from "./sla-badge";

const base = {
  priority: "high",
  createdAt: "2026-01-01T00:00:00.000Z",
  closedAt: "2026-01-01T10:00:00.000Z",
  ticketStatus: "closed",
};

describe("ticket SLA badge", () => {
  it("labels directly closed tickets without a met or breached result in the compact view", () => {
    const html = renderToStaticMarkup(createElement(SLABadge, { ...base, resolvedAt: null }));
    expect(html).toContain("Closed without resolution");
    expect(html).not.toMatch(/Resolved in|Breached by|Overdue by/);
  });

  it("does not show a progress bar, deadline or target for direct closure in the full view", () => {
    const html = renderToStaticMarkup(createElement(SLABadge, { ...base, resolvedAt: null, variant: "full" }));
    expect(html).toContain("SLA not applicable");
    expect(html).toContain("Closed without resolution");
    expect(html).not.toMatch(/Resolved in|Breached by|Overdue by|Deadline|Target|width:/);
  });

  it("keeps the hold-aware result and deadline when closed after resolution", () => {
    const html = renderToStaticMarkup(createElement(SLABadge, {
      ...base, resolvedAt: "2026-01-01T10:00:00.000Z", totalHoldSeconds: 4 * 3600, variant: "full",
    }));
    expect(html).toContain("Resolved in 6h");
    expect(html).toContain("Deadline");
    expect(html).toContain("Target");
    expect(html).not.toContain("not applicable");
  });
});
