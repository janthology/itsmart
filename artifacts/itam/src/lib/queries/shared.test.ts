import { describe, it, expect } from "vitest";
import { getResolvedTicketAutoCloseAt, RESOLVED_TICKET_AUTO_CLOSE_DAYS } from "./shared";

describe("resolved-ticket auto-close lifecycle", () => {
  it("uses a 7-day inactivity window", () => {
    expect(RESOLVED_TICKET_AUTO_CLOSE_DAYS).toBe(7);
  });

  it("closes 7 days after the last activity of a resolved ticket", () => {
    const at = getResolvedTicketAutoCloseAt({
      status: "resolved",
      resolvedAt: "2026-01-01T00:00:00.000Z",
      lastActivityAt: "2026-01-03T12:00:00.000Z",
    });
    expect(at?.toISOString()).toBe("2026-01-10T12:00:00.000Z");
  });

  it("falls back to updatedAt, then resolvedAt, as the activity base", () => {
    const at = getResolvedTicketAutoCloseAt({
      status: "resolved",
      resolvedAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
    expect(at?.toISOString()).toBe("2026-01-09T00:00:00.000Z");
  });

  it("never auto-closes tickets that are not currently resolved", () => {
    expect(getResolvedTicketAutoCloseAt({ status: "closed", resolvedAt: "2026-01-01T00:00:00.000Z" })).toBeNull();
    expect(getResolvedTicketAutoCloseAt({ status: "open" })).toBeNull();
  });

  it("returns null when there is no usable timestamp", () => {
    expect(getResolvedTicketAutoCloseAt({ status: "resolved" })).toBeNull();
    expect(getResolvedTicketAutoCloseAt({ status: "resolved", lastActivityAt: "not-a-date" })).toBeNull();
  });
});
