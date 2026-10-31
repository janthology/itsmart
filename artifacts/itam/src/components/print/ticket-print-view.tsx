import { format } from "date-fns";
import { TICKET_PRIORITY_LABEL, TICKET_STATUS_LABEL } from "@/lib/labels";
import { PrintBrandFooter, PrintBrandHeader } from "./print-brand";

/**
 * Popup-free ticket print view (Phase 5b). Rendered in-page inside
 * `.print-area` (hidden on screen, the only thing visible when printing)
 * and printed via window.print(). All values render through React, so
 * user text is escaped automatically — this replaces the old
 * window.open + document.write document that needed manual escapeHtml
 * on every interpolation.
 */

interface PrintComment {
  createdBy: { fullName: string };
  createdAt: string;
  commentText: string;
}

interface TicketPrintViewProps {
  ticketNumber: string;
  title: string;
  priority: string;
  status: string;
  createdByName: string;
  createdAt: string;
  assignedToName?: string | null;
  description: string;
  comments: PrintComment[];
  printedAt: Date;
}

const badge = (background: string, color: string): React.CSSProperties => ({
  display: "inline-block",
  padding: "2px 8px",
  borderRadius: 4,
  fontSize: 12,
  fontWeight: 600,
  marginRight: 6,
  background,
  color,
});

export function TicketPrintView({
  ticketNumber,
  title,
  priority,
  status,
  createdByName,
  createdAt,
  assignedToName,
  description,
  comments,
  printedAt,
}: TicketPrintViewProps) {
  return (
    <div
      style={{
        fontFamily: "Arial, sans-serif",
        padding: 16,
        maxWidth: 800,
        margin: "0 auto",
        color: "#1e293b",
      }}
    >
      <PrintBrandHeader documentType="Support Ticket Record" />
      <h1 style={{ fontSize: 20, marginBottom: 4 }}>{title}</h1>
      <p style={{ color: "#64748b", fontSize: 13, marginBottom: 24 }}>
        <span style={badge("#dbeafe", "#1e40af")}>{ticketNumber}</span>
        <span style={badge("#fef3c7", "#92400e")}>
          {TICKET_PRIORITY_LABEL[priority] ?? priority}
        </span>
        <span style={badge("#e0f2fe", "#0369a1")}>
          {TICKET_STATUS_LABEL[status] ?? status.replace(/_/g, " ")}
        </span>
        &nbsp;|&nbsp; Opened by {createdByName} on{" "}
        {format(new Date(createdAt), "MMMM d, yyyy h:mm a")}
        {assignedToName ? <>&nbsp;|&nbsp; Assigned to {assignedToName}</> : null}
      </p>
      <div
        style={{
          background: "#f8fafc",
          padding: 16,
          borderRadius: 8,
          marginBottom: 24,
          whiteSpace: "pre-wrap",
          fontSize: 14,
        }}
      >
        {description}
      </div>
      <h2 style={{ fontSize: 15, marginBottom: 12 }}>
        Activity Log ({comments.length} entries)
      </h2>
      {comments.map((c, i) => (
        <div
          key={i}
          style={{
            marginBottom: 12,
            padding: 10,
            border: "1px solid #e2e8f0",
            borderRadius: 8,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: 6,
            }}
          >
            <strong>{c.createdBy.fullName}</strong>
            <span style={{ color: "#64748b", fontSize: 12 }}>
              {format(new Date(c.createdAt), "MMM d, yyyy h:mm a")}
            </span>
          </div>
          <p style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 13 }}>
            {c.commentText}
          </p>
        </div>
      ))}
      <PrintBrandFooter printedAt={printedAt} />
    </div>
  );
}
