import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { format, parseISO } from "date-fns";

// ─── Assets ──────────────────────────────────────────────────────────────────

export function exportAssetsXlsx(assets: any[]) {
  const rows = assets.map((a) => ({
    "Asset Tag": a.assetTag,
    "Name": a.name,
    "Model": a.model ?? "",
    "Category": a.category,
    "Status": a.status,
    "Serial No.": a.serialNumber ?? "",
    "Location": a.location ?? "",
    "Assigned To": a.assignedTo?.fullName ?? "",
    "Department": a.assignedTo?.department ?? "",
    "Purchase Date": a.purchaseDate ? format(new Date(a.purchaseDate), "yyyy-MM-dd") : "",
    "Purchase Value (₱)": a.purchaseValue ?? "",
    "Notes": a.notes ?? "",
    "Created At": format(new Date(a.createdAt), "yyyy-MM-dd"),
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Assets");
  XLSX.writeFile(wb, `assets-report-${format(new Date(), "yyyyMMdd")}.xlsx`);
}

export function exportAssetsPdf(assets: any[], filters: { status?: string; from?: string; to?: string } = {}) {
  const doc = new jsPDF({ orientation: "landscape" });

  doc.setFontSize(16);
  doc.text("Asset Inventory Report", 14, 16);
  doc.setFontSize(10);
  doc.setTextColor(120);
  let y = 23;
  doc.text(`Generated: ${format(new Date(), "MMMM d, yyyy h:mm a")}`, 14, y);
  if (filters.status) { y += 6; doc.text(`Filter: Status = ${filters.status}`, 14, y); }
  if (filters.from || filters.to) {
    y += 6;
    const range = [filters.from && `From: ${format(parseISO(filters.from), "MMM d, yyyy")}`, filters.to && `To: ${format(parseISO(filters.to), "MMM d, yyyy")}`].filter(Boolean).join("  ");
    doc.text(`Date Range: ${range}`, 14, y);
  }
  doc.setTextColor(0);

  autoTable(doc, {
    startY: y + 5,
    head: [["Tag", "Name", "Category", "Status", "Serial No.", "Location", "Assigned To", "Purchase Date", "Value (₱)"]],
    body: assets.map((a) => [
      a.assetTag,
      a.name + (a.model ? `\n${a.model}` : ""),
      a.category,
      a.status,
      a.serialNumber ?? "—",
      a.location ?? "—",
      a.assignedTo?.fullName ?? "Unassigned",
      a.purchaseDate ? format(new Date(a.purchaseDate), "MMM d, yyyy") : "—",
      a.purchaseValue != null ? `₱${Number(a.purchaseValue).toLocaleString()}` : "—",
    ]),
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [18, 52, 86], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [245, 247, 250] },
  });

  doc.save(`assets-report-${format(new Date(), "yyyyMMdd")}.pdf`);
}

// ─── Tickets ─────────────────────────────────────────────────────────────────

export function exportTicketsXlsx(tickets: any[]) {
  const rows = tickets.map((t) => ({
    "Ticket No.": (t as any).ticketNumber ?? t.id.substring(0, 8),
    "Title": t.title,
    "Status": t.status.replace(/_/g, " "),
    "Priority": t.priority,
    "Requester": t.createdBy?.fullName ?? "",
    "Assigned To": t.assignedTo?.fullName ?? "",
    "Asset": t.asset?.name ?? "",
    "Asset Tag": t.asset?.assetTag ?? "",
    "Created At": format(new Date(t.createdAt), "yyyy-MM-dd HH:mm"),
    "Resolved At": t.resolvedAt ? format(new Date(t.resolvedAt), "yyyy-MM-dd HH:mm") : "",
    "Closed At": t.closedAt ? format(new Date(t.closedAt), "yyyy-MM-dd HH:mm") : "",
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Tickets");
  XLSX.writeFile(wb, `tickets-report-${format(new Date(), "yyyyMMdd")}.xlsx`);
}

export function exportTicketsPdf(tickets: any[], filters: { status?: string; priority?: string; from?: string; to?: string } = {}) {
  const doc = new jsPDF({ orientation: "landscape" });

  doc.setFontSize(16);
  doc.text("Support Tickets Report", 14, 16);
  doc.setFontSize(10);
  doc.setTextColor(120);
  let y = 23;
  doc.text(`Generated: ${format(new Date(), "MMMM d, yyyy h:mm a")}`, 14, y);
  if (filters.status) { y += 6; doc.text(`Filter: Status = ${filters.status.replace(/_/g, " ")}`, 14, y); }
  if (filters.priority) { y += 6; doc.text(`Filter: Priority = ${filters.priority}`, 14, y); }
  if (filters.from || filters.to) {
    y += 6;
    const range = [filters.from && `From: ${format(parseISO(filters.from), "MMM d, yyyy")}`, filters.to && `To: ${format(parseISO(filters.to), "MMM d, yyyy")}`].filter(Boolean).join("  ");
    doc.text(`Date Range: ${range}`, 14, y);
  }
  doc.setTextColor(0);

  autoTable(doc, {
    startY: y + 5,
    head: [["Ticket No.", "Title", "Status", "Priority", "Requester", "Assigned To", "Asset", "Created", "Resolved"]],
    body: tickets.map((t) => [
      (t as any).ticketNumber ?? `#${t.id.substring(0, 8)}`,
      t.title,
      t.status.replace(/_/g, " "),
      t.priority,
      t.createdBy?.fullName ?? "—",
      t.assignedTo?.fullName ?? "—",
      t.asset?.name ?? "—",
      format(new Date(t.createdAt), "MMM d, yyyy"),
      t.resolvedAt ? format(new Date(t.resolvedAt), "MMM d, yyyy") : "—",
    ]),
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [18, 52, 86], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [245, 247, 250] },
  });

  doc.save(`tickets-report-${format(new Date(), "yyyyMMdd")}.pdf`);
}

// ─── Asset Assignment / History Report ───────────────────────────────────────

export function exportAssetHistoryXlsx(history: any[]) {
  const rows = history.map((h) => ({
    "Asset Tag": h.assetTag ?? "",
    "Asset Name": h.assetName ?? "",
    "Action": h.action,
    "Field": h.fieldName ?? "",
    "Old Value": h.oldValue ?? "",
    "New Value": h.newValue ?? "",
    "Changed By": h.changedBy?.fullName ?? "",
    "Date": format(new Date(h.createdAt), "yyyy-MM-dd HH:mm"),
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Asset History");
  XLSX.writeFile(wb, `asset-history-${format(new Date(), "yyyyMMdd")}.xlsx`);
}

export function exportAssetHistoryPdf(history: any[], filters: { from?: string; to?: string } = {}) {
  const doc = new jsPDF({ orientation: "landscape" });
  doc.setFontSize(16);
  doc.text("Asset Assignment & History Report", 14, 16);
  doc.setFontSize(10); doc.setTextColor(120);
  let y = 23;
  doc.text(`Generated: ${format(new Date(), "MMMM d, yyyy h:mm a")}`, 14, y);
  if (filters.from || filters.to) {
    y += 6;
    const range = [filters.from && `From: ${format(parseISO(filters.from), "MMM d, yyyy")}`, filters.to && `To: ${format(parseISO(filters.to), "MMM d, yyyy")}`].filter(Boolean).join("  ");
    doc.text(`Date Range: ${range}`, 14, y);
  }
  doc.setTextColor(0);
  autoTable(doc, {
    startY: y + 5,
    head: [["Asset Tag", "Asset Name", "Action", "Field", "Old Value", "New Value", "Changed By", "Date"]],
    body: history.map((h) => [
      h.assetTag ?? "—", h.assetName ?? "—",
      h.action, h.fieldName ?? "—",
      h.oldValue ?? "—", h.newValue ?? "—",
      h.changedBy?.fullName ?? "—",
      format(new Date(h.createdAt), "MMM d, yyyy HH:mm"),
    ]),
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [18, 52, 86], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [245, 247, 250] },
  });
  doc.save(`asset-history-${format(new Date(), "yyyyMMdd")}.pdf`);
}

// ─── Ticket Resolution Performance Report ────────────────────────────────────

const SLA_HOURS: Record<string, number> = { critical: 4, high: 8, medium: 24, low: 72 };

export function exportTicketPerformanceXlsx(tickets: any[]) {
  const rows = tickets.map((t) => {
    const target = SLA_HOURS[t.priority] ?? 24;
    const resMs = t.resolvedAt ? new Date(t.resolvedAt).getTime() - new Date(t.createdAt).getTime() : null;
    const resH = resMs != null ? +(resMs / 3600000).toFixed(2) : null;
    return {
      "Ticket No.": t.ticketNumber ?? t.id.substring(0, 8),
      "Title": t.title,
      "Priority": t.priority,
      "Type": t.type ?? "",
      "Status": t.status.replace(/_/g, " "),
      "Requester": t.createdBy?.fullName ?? "",
      "Assigned To": t.assignedTo?.fullName ?? "",
      "Created At": format(new Date(t.createdAt), "yyyy-MM-dd HH:mm"),
      "Resolved At": t.resolvedAt ? format(new Date(t.resolvedAt), "yyyy-MM-dd HH:mm") : "",
      "Resolution Time (h)": resH ?? "",
      "SLA Target (h)": target,
      "SLA Status": resH == null ? "Pending" : resH <= target ? "Met" : "Breached",
    };
  });
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Performance");
  XLSX.writeFile(wb, `ticket-performance-${format(new Date(), "yyyyMMdd")}.xlsx`);
}

export function exportTicketPerformancePdf(tickets: any[], filters: { from?: string; to?: string } = {}) {
  const doc = new jsPDF({ orientation: "landscape" });
  doc.setFontSize(16);
  doc.text("Ticket Resolution Performance Report", 14, 16);
  doc.setFontSize(10); doc.setTextColor(120);
  let y = 23;
  doc.text(`Generated: ${format(new Date(), "MMMM d, yyyy h:mm a")}`, 14, y);
  if (filters.from || filters.to) {
    y += 6;
    const range = [filters.from && `From: ${format(parseISO(filters.from), "MMM d, yyyy")}`, filters.to && `To: ${format(parseISO(filters.to), "MMM d, yyyy")}`].filter(Boolean).join("  ");
    doc.text(`Date Range: ${range}`, 14, y);
  }
  doc.setTextColor(0);
  autoTable(doc, {
    startY: y + 5,
    head: [["Ticket No.", "Title", "Priority", "Assigned To", "Created", "Resolved", "Res. Time (h)", "SLA Target (h)", "SLA"]],
    body: tickets.map((t) => {
      const target = SLA_HOURS[t.priority] ?? 24;
      const resMs = t.resolvedAt ? new Date(t.resolvedAt).getTime() - new Date(t.createdAt).getTime() : null;
      const resH = resMs != null ? +(resMs / 3600000).toFixed(2) : null;
      const slaStatus = resH == null ? "Pending" : resH <= target ? "Met" : "Breached";
      return [
        t.ticketNumber ?? `#${t.id.substring(0, 8)}`,
        t.title,
        t.priority,
        t.assignedTo?.fullName ?? "—",
        format(new Date(t.createdAt), "MMM d, yyyy"),
        t.resolvedAt ? format(new Date(t.resolvedAt), "MMM d, yyyy") : "—",
        resH ?? "—",
        target,
        slaStatus,
      ];
    }),
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [18, 52, 86], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [245, 247, 250] },
    didParseCell: (data) => {
      if (data.column.index === 8 && data.section === "body") {
        const v = data.cell.raw as string;
        if (v === "Met") data.cell.styles.textColor = [22, 163, 74];
        else if (v === "Breached") data.cell.styles.textColor = [220, 38, 38];
      }
    },
  });
  doc.save(`ticket-performance-${format(new Date(), "yyyyMMdd")}.pdf`);
}

// ─── User Activity Report ─────────────────────────────────────────────────────

export function exportUserActivityXlsx(users: any[]) {
  const rows = users.map((u) => ({
    "Full Name": u.fullName,
    "Email": u.email ?? "",
    "Role": u.role.replace(/_/g, " "),
    "Department": u.department ?? "",
    "Status": u.isActive ? "Active" : "Inactive",
    "Assets Assigned": u.assetsAssigned ?? 0,
    "Tickets Created": u.ticketsCreated ?? 0,
    "Tickets Resolved": u.ticketsResolved ?? 0,
    "Joined": format(new Date(u.createdAt), "yyyy-MM-dd"),
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "User Activity");
  XLSX.writeFile(wb, `user-activity-${format(new Date(), "yyyyMMdd")}.xlsx`);
}

export function exportUserActivityPdf(users: any[]) {
  const doc = new jsPDF({ orientation: "landscape" });
  doc.setFontSize(16);
  doc.text("User Activity Report", 14, 16);
  doc.setFontSize(10); doc.setTextColor(120);
  doc.text(`Generated: ${format(new Date(), "MMMM d, yyyy h:mm a")}`, 14, 23);
  doc.setTextColor(0);
  autoTable(doc, {
    startY: 30,
    head: [["Full Name", "Email", "Role", "Department", "Status", "Assets", "Tickets Created", "Tickets Resolved", "Joined"]],
    body: users.map((u) => [
      u.fullName, u.email ?? "—",
      u.role.replace(/_/g, " "),
      u.department ?? "—",
      u.isActive ? "Active" : "Inactive",
      u.assetsAssigned ?? 0,
      u.ticketsCreated ?? 0,
      u.ticketsResolved ?? 0,
      format(new Date(u.createdAt), "MMM d, yyyy"),
    ]),
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [18, 52, 86], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [245, 247, 250] },
  });
  doc.save(`user-activity-${format(new Date(), "yyyyMMdd")}.pdf`);
}

// ─── Unassigned Assets Report ─────────────────────────────────────────────────

export function exportUnassignedAssetsXlsx(assets: any[]) {
  const rows = assets.map((a) => ({
    "Asset Tag": a.assetTag,
    "Name": a.name,
    "Model": a.model ?? "",
    "Category": a.category,
    "Status": a.status,
    "Serial No.": a.serialNumber ?? "",
    "Location": a.location ?? "",
    "Purchase Date": a.purchaseDate ? format(new Date(a.purchaseDate), "yyyy-MM-dd") : "",
    "Purchase Value (₱)": a.purchaseValue ?? "",
    "Days Unassigned": a.purchaseDate ? Math.floor((Date.now() - new Date(a.purchaseDate).getTime()) / 86400000) : "",
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Unassigned Assets");
  XLSX.writeFile(wb, `unassigned-assets-${format(new Date(), "yyyyMMdd")}.xlsx`);
}

export function exportUnassignedAssetsPdf(assets: any[]) {
  const doc = new jsPDF({ orientation: "landscape" });
  doc.setFontSize(16);
  doc.text("Unassigned Assets Report", 14, 16);
  doc.setFontSize(10); doc.setTextColor(120);
  doc.text(`Generated: ${format(new Date(), "MMMM d, yyyy h:mm a")}  |  Total: ${assets.length} assets`, 14, 23);
  doc.setTextColor(0);
  autoTable(doc, {
    startY: 30,
    head: [["Tag", "Name", "Model", "Category", "Status", "Serial No.", "Location", "Purchase Date", "Value (₱)"]],
    body: assets.map((a) => [
      a.assetTag, a.name, a.model ?? "—", a.category, a.status,
      a.serialNumber ?? "—", a.location ?? "—",
      a.purchaseDate ? format(new Date(a.purchaseDate), "MMM d, yyyy") : "—",
      a.purchaseValue != null ? `₱${Number(a.purchaseValue).toLocaleString()}` : "—",
    ]),
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [18, 52, 86], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [245, 247, 250] },
  });
  doc.save(`unassigned-assets-${format(new Date(), "yyyyMMdd")}.pdf`);
}

// ─── Asset Depreciation Report ────────────────────────────────────────────────

const USEFUL_LIFE_YEARS = 5; // straight-line over 5 years

function computeDepreciation(purchaseValue: number, purchaseDate: string) {
  const ageMs = Date.now() - new Date(purchaseDate).getTime();
  const ageYears = ageMs / (1000 * 60 * 60 * 24 * 365.25);
  const annualDep = purchaseValue / USEFUL_LIFE_YEARS;
  const accumulated = Math.min(annualDep * ageYears, purchaseValue);
  const currentValue = Math.max(purchaseValue - accumulated, 0);
  const pctDepreciated = Math.min(Math.round((accumulated / purchaseValue) * 100), 100);
  return { ageYears: +ageYears.toFixed(2), annualDep: +annualDep.toFixed(2), accumulated: +accumulated.toFixed(2), currentValue: +currentValue.toFixed(2), pctDepreciated };
}

export function exportDepreciationXlsx(assets: any[]) {
  const rows = assets
    .filter((a) => a.purchaseValue != null && a.purchaseDate)
    .map((a) => {
      const d = computeDepreciation(Number(a.purchaseValue), a.purchaseDate);
      return {
        "Asset Tag": a.assetTag,
        "Name": a.name,
        "Category": a.category,
        "Status": a.status,
        "Assigned To": a.assignedTo?.fullName ?? "Unassigned",
        "Purchase Date": format(new Date(a.purchaseDate), "yyyy-MM-dd"),
        "Purchase Value (₱)": Number(a.purchaseValue),
        "Age (Years)": d.ageYears,
        "Annual Depreciation (₱)": d.annualDep,
        "Accumulated Depreciation (₱)": d.accumulated,
        "Current Value (₱)": d.currentValue,
        "% Depreciated": d.pctDepreciated,
      };
    });
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Depreciation");
  XLSX.writeFile(wb, `asset-depreciation-${format(new Date(), "yyyyMMdd")}.xlsx`);
}

export function exportDepreciationPdf(assets: any[]) {
  const eligible = assets.filter((a) => a.purchaseValue != null && a.purchaseDate);
  const doc = new jsPDF({ orientation: "landscape" });
  doc.setFontSize(16);
  doc.text("Asset Depreciation Report", 14, 16);
  doc.setFontSize(10); doc.setTextColor(120);
  doc.text(`Generated: ${format(new Date(), "MMMM d, yyyy h:mm a")}  |  Straight-line over ${USEFUL_LIFE_YEARS} years`, 14, 23);
  doc.setTextColor(0);
  autoTable(doc, {
    startY: 30,
    head: [["Tag", "Name", "Category", "Purchase Date", "Purchase Value (₱)", "Age (yrs)", "Annual Dep. (₱)", "Accumulated (₱)", "Current Value (₱)", "% Dep."]],
    body: eligible.map((a) => {
      const d = computeDepreciation(Number(a.purchaseValue), a.purchaseDate);
      return [
        a.assetTag, a.name, a.category,
        format(new Date(a.purchaseDate), "MMM d, yyyy"),
        `₱${Number(a.purchaseValue).toLocaleString()}`,
        d.ageYears,
        `₱${d.annualDep.toLocaleString()}`,
        `₱${d.accumulated.toLocaleString()}`,
        `₱${d.currentValue.toLocaleString()}`,
        `${d.pctDepreciated}%`,
      ];
    }),
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [18, 52, 86], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [245, 247, 250] },
  });
  doc.save(`asset-depreciation-${format(new Date(), "yyyyMMdd")}.pdf`);
}

// ─── Ticket Satisfaction Summary ──────────────────────────────────────────────

export function exportSatisfactionXlsx(tickets: any[]) {
  const rated = tickets.filter((t) => t.satisfactionRating != null);
  const rows = rated.map((t) => ({
    "Ticket No.": t.ticketNumber ?? t.id.substring(0, 8),
    "Title": t.title,
    "Priority": t.priority,
    "Assigned To": t.assignedTo?.fullName ?? "—",
    "Requester": t.createdBy?.fullName ?? "—",
    "Resolved At": t.resolvedAt ? format(new Date(t.resolvedAt), "yyyy-MM-dd") : "",
    "Rating (1-5)": t.satisfactionRating,
    "Comment": t.satisfactionComment ?? "",
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Satisfaction");
  XLSX.writeFile(wb, `satisfaction-report-${format(new Date(), "yyyyMMdd")}.xlsx`);
}

export function exportSatisfactionPdf(tickets: any[]) {
  const rated = tickets.filter((t) => t.satisfactionRating != null);
  const avg = rated.length ? (rated.reduce((s, t) => s + t.satisfactionRating, 0) / rated.length).toFixed(2) : "N/A";
  const dist = [1, 2, 3, 4, 5].map((s) => rated.filter((t) => t.satisfactionRating === s).length);

  const doc = new jsPDF({ orientation: "landscape" });
  doc.setFontSize(16);
  doc.text("Ticket Satisfaction Summary Report", 14, 16);
  doc.setFontSize(10); doc.setTextColor(120);
  doc.text(`Generated: ${format(new Date(), "MMMM d, yyyy h:mm a")}  |  Rated tickets: ${rated.length}  |  Average: ${avg}/5`, 14, 23);
  doc.text(`Distribution — 1★: ${dist[0]}  2★: ${dist[1]}  3★: ${dist[2]}  4★: ${dist[3]}  5★: ${dist[4]}`, 14, 29);
  doc.setTextColor(0);
  autoTable(doc, {
    startY: 35,
    head: [["Ticket No.", "Title", "Priority", "Assigned To", "Requester", "Resolved At", "Rating", "Comment"]],
    body: rated.map((t) => [
      t.ticketNumber ?? `#${t.id.substring(0, 8)}`,
      t.title, t.priority,
      t.assignedTo?.fullName ?? "—",
      t.createdBy?.fullName ?? "—",
      t.resolvedAt ? format(new Date(t.resolvedAt), "MMM d, yyyy") : "—",
      `${t.satisfactionRating}/5`,
      t.satisfactionComment ?? "—",
    ]),
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [18, 52, 86], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [245, 247, 250] },
  });
  doc.save(`satisfaction-report-${format(new Date(), "yyyyMMdd")}.pdf`);
}
