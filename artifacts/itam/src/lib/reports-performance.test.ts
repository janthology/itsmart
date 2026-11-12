import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  jsonToSheet: vi.fn((rows: unknown) => rows),
  aoaToSheet: vi.fn((rows: unknown) => rows),
  appendSheet: vi.fn(),
  writeFile: vi.fn(),
  autoTable: vi.fn(),
}));

vi.mock("xlsx", () => ({
  utils: {
    json_to_sheet: mocks.jsonToSheet,
    aoa_to_sheet: mocks.aoaToSheet,
    book_new: () => ({}),
    book_append_sheet: mocks.appendSheet,
  },
  writeFile: mocks.writeFile,
}));

vi.mock("jspdf", () => ({
  default: class {
    internal = { pageSize: { getWidth: () => 297, getHeight: () => 210 } };
    setFontSize() {} setTextColor() {} text() {} setPage() {} save() {}
    getNumberOfPages() { return 1; }
  },
}));
vi.mock("jspdf-autotable", () => ({ default: mocks.autoTable }));

import { exportTicketPerformancePdf, exportTicketPerformanceXlsx } from "./reports";

const base = {
  id: "ticket-1", title: "Example", priority: "high", status: "resolved", createdAt: "2026-01-01T00:00:00Z",
  resolvedAt: "2026-01-01T10:00:00Z", totalHoldSeconds: 4 * 3600,
};
const tickets = [
  base,
  { ...base, id: "ticket-2", resolvedAt: "2026-01-01T08:00:10Z", totalHoldSeconds: 0 },
  { ...base, id: "ticket-3", status: "closed", resolvedAt: null },
  { ...base, id: "ticket-4", status: "on_hold", resolvedAt: null },
];

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.useRealTimers());

describe("ticket performance exports", () => {
  it("writes hold-aware hours and the same unrounded outcomes to Excel", async () => {
    await exportTicketPerformanceXlsx(tickets);
    const rows = mocks.jsonToSheet.mock.calls[0][0] as Record<string, unknown>[];
    expect(rows.map((r) => [r["Resolution Time (h)"], r["SLA Status"]])).toEqual([
      [6, "Met"], [8, "Breached"], ["", "Closed without resolution"], ["", "Pending"],
    ]);
    expect(mocks.appendSheet.mock.calls.map((args) => args[2])).toEqual(["Performance", "Notes"]);
    expect(mocks.writeFile).toHaveBeenCalledOnce();
  });

  it("writes matching hours and outcomes to the PDF table", async () => {
    await exportTicketPerformancePdf(tickets);
    const options = mocks.autoTable.mock.calls[0][1] as { body: unknown[][] };
    expect(options.body.map((row) => [row[6], row[8]])).toEqual([
      [6, "Met"], [8, "Breached"], ["—", "Closed without resolution"], ["—", "Pending"],
    ]);
  });
});

// Regression checks for asset report integrity.
describe("asset report audit", () => {
  it("does not claim time since purchase is time spent unassigned", async () => {
    const { exportUnassignedAssetsXlsx } = await import('./reports');
    await exportUnassignedAssetsXlsx([{ assetTag: 'A-1', name: 'Example', category: 'laptop', status: 'active', purchaseDate: '2020-01-01' }]);
    const row = (mocks.jsonToSheet.mock.calls[0][0] as Record<string, unknown>[])[0];
    expect(row).not.toHaveProperty('Days Unassigned');
  });

  it("does not export NaN depreciation for a zero-value asset", async () => {
    const { exportDepreciationXlsx } = await import('./reports');
    await exportDepreciationXlsx([{ assetTag: 'A-2', name: 'Example', category: 'laptop', status: 'active', purchaseDate: '2020-01-01', purchaseValue: 0 }]);
    const row = (mocks.jsonToSheet.mock.calls[0][0] as Record<string, unknown>[])[0];
    expect(row['% Depreciated']).toBe('');
    expect(row['Current Value (₱)']).toBe(0);
  });

  it("uses the same future-date and zero-cost rules in Excel and PDF", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const { exportDepreciationXlsx, exportDepreciationPdf } = await import('./reports');
    const assets = [
      { assetTag: 'A-1', name: 'Future', category: 'laptop', status: 'active', purchaseDate: '2027-01-01', purchaseValue: 5000 },
      { assetTag: 'A-2', name: 'Zero', category: 'laptop', status: 'active', purchaseDate: '2020-01-01', purchaseValue: 0 },
    ];
    await exportDepreciationXlsx(assets);
    const rows = mocks.jsonToSheet.mock.calls[0][0] as Record<string, unknown>[];
    expect(rows.map(r => [r['Age (Years)'], r['Accumulated Depreciation (₱)'], r['Current Value (₱)'], r['% Depreciated']])).toEqual([[0, 0, 5000, 0], [6, 0, 0, '']]);
    await exportDepreciationPdf(assets);
    const body = (mocks.autoTable.mock.calls[0][1] as { body: unknown[][] }).body;
    expect(body[0].slice(5)).toEqual([0, '₱1,000', '₱0', '₱5,000', '0%']);
    expect(body[1].slice(5)).toEqual([6, '₱0', '₱0', '₱0', 'N/A']);
  });

});
