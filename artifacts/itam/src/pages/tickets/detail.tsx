import { useState, useEffect, useCallback, useMemo } from "react";
import { useRoute, Link } from "wouter";
import { useGetTicket, useUpdateTicket, useAddTicketComment, useGetSupportStaff, useGetUsers, useSubmitSatisfactionRating, useGetStaffWorkload, TicketStatus, TicketType, TICKET_TYPE_LABEL } from "@/lib/supabase-queries";
import { useAuth } from "@/lib/auth-context";
import { AppLayout } from "@/components/layout/app-layout";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Loader2, ArrowLeft, Send, MessageSquare, Clock, ShieldAlert, MonitorSmartphone, UserCheck, AlertTriangle, Star, Copy, Check, Printer, TicketIcon, History } from "lucide-react";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { SLABadge } from "@/components/ui/sla-badge";
import { cn } from "@/lib/utils";

function priorityStripe(priority: string) {
  if (priority === "critical") return "bg-red-500";
  if (priority === "high") return "bg-amber-500";
  if (priority === "medium") return "bg-sky-500";
  return "bg-slate-300";
}

type Role = 'administrator' | 'support_staff' | 'general_user';

const STATUS_LABEL: Record<string, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  on_hold: 'On Hold',
  resolved: 'Resolved',
  closed: 'Closed',
};

// Statuses that require a remarks dialog before applying
const REQUIRES_REMARKS = new Set(['on_hold', 'resolved', 'closed']);

const PRIORITY_RANK: Record<string, number> = {
  critical: 1, high: 2, medium: 3, low: 4,
};
const PRIORITY_LABEL: Record<string, string> = {
  critical: 'Critical - 1', high: 'High - 2', medium: 'Medium - 3', low: 'Low - 4',
};

function getAllowedTransitions(current: string, role: Role): string[] {
  if (role === 'administrator') {
    const map: Record<string, string[]> = {
      open:        ['in_progress', 'closed'],
      in_progress: ['open', 'on_hold', 'resolved'],
      on_hold:     ['in_progress', 'open'],
      resolved:    ['in_progress', 'closed'],
      closed:      [],
    };
    return map[current] ?? [];
  }
  if (role === 'support_staff') {
    const map: Record<string, string[]> = {
      open:        ['in_progress', 'closed'],
      in_progress: ['open', 'on_hold', 'resolved'],
      on_hold:     ['in_progress'],
      resolved:    ['in_progress', 'closed'],
      closed:      [],
    };
    return map[current] ?? [];
  }
  // general_user
  const map: Record<string, string[]> = {
    resolved: ['in_progress', 'closed'],
  };
  return map[current] ?? [];
}

export default function TicketDetail() {
  const [, params] = useRoute("/tickets/:id");
  const id = params?.id || "";
  const { user } = useAuth();
  const isAdmin = user?.role === 'administrator';
  const isSupport = user?.role === 'support_staff';
  const canManage = isAdmin || isSupport;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: ticket, isLoading, isError } = useGetTicket(id);
  const updateMutation = useUpdateTicket();
  const commentMutation = useAddTicketComment();
  const { data: supportStaff } = useGetSupportStaff();
  const { data: allUsers } = useGetUsers();
  // Assignable staff = support staff + administrators, for both the dropdown and workload ranking
  const assignableStaff = (allUsers ?? []).filter(u => u.role === 'support_staff' || u.role === 'administrator');
  const { data: staffWorkload = [] } = useGetStaffWorkload();
  const satisfactionMutation = useSubmitSatisfactionRating();

  // Smart routing: rank assignable staff by workload (fewer active = better)
  const rankedStaff = useMemo(() => {
    if (!assignableStaff.length) return [];
    return [...assignableStaff].sort((a, b) => {
      const aLoad = staffWorkload.find(w => w.id === a.id)?.totalActive ?? 0;
      const bLoad = staffWorkload.find(w => w.id === b.id)?.totalActive ?? 0;
      return aLoad - bLoad; // lowest workload first
    });
  }, [assignableStaff, staffWorkload]);

  const [commentText, setCommentText] = useState("");
  const [copied, setCopied] = useState(false);
  const MAX_COMMENT = 1000;
  const [hoverRating, setHoverRating] = useState(0);
  const [selectedRating, setSelectedRating] = useState(0);
  const [satisfactionComment, setSatisfactionComment] = useState("");

  // Remarks/confirm dialog state
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);
  const [remarksText, setRemarksText] = useState("");

  // Priority confirmation state
  const [pendingPriority, setPendingPriority] = useState<string | null>(null);

  // Called when user picks a new status from the dropdown
  const handleStatusSelect = (newStatus: string) => {
    if (REQUIRES_REMARKS.has(newStatus)) {
      setPendingStatus(newStatus);
      setRemarksText("");
    } else {
      applyStatusChange(newStatus, null);
    }
  };

  // Actually commits the status change + logs comment
  const applyStatusChange = async (newStatus: string, remarks: string | null) => {
    try {
      const updates: any = { status: newStatus as TicketStatus };
      if (newStatus === 'open') updates.assignedToId = null;
      await updateMutation.mutateAsync({ id, data: updates });

      let remark = newStatus === 'open' && ticket?.assignedTo
        ? `🔄 Status changed to "${STATUS_LABEL[newStatus]}" by ${user?.fullName ?? 'Unknown'}. Ticket unassigned.`
        : `🔄 Status changed to "${STATUS_LABEL[newStatus] ?? newStatus}" by ${user?.fullName ?? 'Unknown'}.`;
      if (remarks?.trim()) remark += `\n\n📝 Remarks: ${remarks.trim()}`;

      await commentMutation.mutateAsync({ id, data: { commentText: remark } });
      toast({ title: "Status updated", description: `Ticket marked as ${STATUS_LABEL[newStatus]}.` });
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: "Failed to update status." });
    } finally {
      setPendingStatus(null);
      setRemarksText("");
    }
  };

  const handleAssign = async (assigneeId: string | null) => {
    try {
      const updates: any = { assignedToId: assigneeId };
      if (assigneeId && ticket?.status === 'open') updates.status = 'in_progress' as TicketStatus;
      if (!assigneeId && ticket?.status === 'in_progress') updates.status = 'open' as TicketStatus;
      await updateMutation.mutateAsync({ id, data: updates });

      const assigneeName = assigneeId
        ? (assignableStaff.find(s => s.id === assigneeId)?.fullName ?? (user?.id === assigneeId ? user?.fullName : 'Unknown'))
        : null;
      const statusNote =
        assigneeId && ticket?.status === "open"
          ? ' Status set to "in progress".'
          : !assigneeId && ticket?.status === "in_progress"
            ? ' Status reverted to "open".'
            : "";
      const remark = assigneeId
        ? `👤 Ticket assigned to ${assigneeName} by ${user?.fullName ?? 'Unknown'}.${statusNote}`
        : `🔓 Ticket unassigned by ${user?.fullName ?? 'Unknown'}.${statusNote}`;
      await commentMutation.mutateAsync({ id, data: { commentText: remark } });
      toast({ title: "Ticket assigned", description: assigneeId ? "Assignee updated." : "Assignee removed." });
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: "Failed to assign ticket." });
    }
  };

  const applyPriorityChange = async () => {
    if (!pendingPriority) return;
    const oldPriority = ticket?.priority ?? '';
    const newPriority = pendingPriority;
    setPendingPriority(null); // close immediately
    try {
      await updateMutation.mutateAsync({ id, data: { priority: newPriority as any } });
      await commentMutation.mutateAsync({ id, data: {
        commentText: `${PRIORITY_RANK[newPriority] < PRIORITY_RANK[oldPriority] ? '⬆️' : '⬇️'} Priority changed from "${PRIORITY_LABEL[oldPriority]}" to "${PRIORITY_LABEL[newPriority]}" by ${user?.fullName ?? 'Unknown'}.`
      }});
      toast({ title: "Priority updated", description: `Priority set to ${PRIORITY_LABEL[newPriority]}.` });
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Failed to update priority." });
    }
  };

  const handleAddComment = async () => {
    if (!commentText.trim()) return;
    try {
      await commentMutation.mutateAsync({ id, data: { commentText } });
      setCommentText("");
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: "Failed to add comment." });
    }
  };

  const handleSubmitRating = async () => {
    if (!selectedRating) return;
    try {
      await satisfactionMutation.mutateAsync({ id, rating: selectedRating, comment: satisfactionComment || undefined });
      toast({ title: "Thank you!", description: "Your feedback has been submitted." });
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Failed to submit rating." });
    }
  };

  const handleCopyTicketNumber = () => {
    const num = (ticket as any)?.ticketNumber ?? ticket?.id?.substring(0, 8) ?? '';

    // navigator.clipboard only works on secure contexts (HTTPS / localhost).
    // For plain HTTP (LAN dev server), fall back to the legacy execCommand approach.
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(num).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }).catch(() => fallbackCopy(num));
    } else {
      fallbackCopy(num);
    }
  };

  const fallbackCopy = (text: string) => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.top = '-9999px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      document.execCommand('copy');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // execCommand also failed — nothing we can do silently
    } finally {
      document.body.removeChild(ta);
    }
  };

  const handlePrint = () => {
    if (!ticket) return;
    const win = window.open('', '_blank', 'width=800,height=900');
    if (!win) return;
    const comments = ticket.comments.map((c: { createdBy: { fullName: string }; createdAt: string; commentText: string }) => `
      <div style="margin-bottom:12px;padding:10px;border:1px solid #e2e8f0;border-radius:8px;">
        <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
          <strong>${c.createdBy.fullName}</strong>
          <span style="color:#64748b;font-size:12px;">${format(new Date(c.createdAt), 'MMM d, yyyy h:mm a')}</span>
        </div>
        <p style="margin:0;white-space:pre-wrap;font-size:13px;">${c.commentText}</p>
      </div>`).join('');
    win.document.write(`<!DOCTYPE html><html><head><title>${(ticket as any).ticketNumber ?? ticket.id}</title>
      <style>body{font-family:Arial,sans-serif;padding:32px;max-width:800px;margin:0 auto;color:#1e293b;}
      h1{font-size:20px;margin-bottom:4px;}
      .meta{color:#64748b;font-size:13px;margin-bottom:24px;}
      .badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600;margin-right:6px;}
      .desc{background:#f8fafc;padding:16px;border-radius:8px;margin-bottom:24px;white-space:pre-wrap;font-size:14px;}
      @media print{body{padding:16px;}}</style></head><body>
      <p style="color:#355872;font-weight:700;font-size:13px;margin-bottom:8px;">ITSMART — Support Ticket</p>
      <h1>${ticket.title}</h1>
      <p class="meta">
        <span class="badge" style="background:#dbeafe;color:#1e40af;">${(ticket as any).ticketNumber ?? ticket.id.substring(0,8)}</span>
        <span class="badge" style="background:#fef3c7;color:#92400e;">${ticket.priority}</span>
        <span class="badge" style="background:#e0f2fe;color:#0369a1;">${ticket.status.replace(/_/g,' ')}</span>
        &nbsp;|&nbsp; Opened by ${ticket.createdBy.fullName} on ${format(new Date(ticket.createdAt), 'MMMM d, yyyy h:mm a')}
        ${ticket.assignedTo ? `&nbsp;|&nbsp; Assigned to ${ticket.assignedTo.fullName}` : ''}
      </p>
      <div class="desc">${ticket.description}</div>
      <h2 style="font-size:15px;margin-bottom:12px;">Activity Log (${ticket.comments.length} entries)</h2>
      ${comments}
      <p style="color:#94a3b8;font-size:11px;margin-top:24px;">Printed on ${format(new Date(), 'MMMM d, yyyy h:mm a')}</p>
      <script>window.onload=()=>{window.print();}<\/script></body></html>`);
    win.document.close();
  };

  // Keyboard shortcut: N = new ticket (handled on list page), / = focus search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (pendingStatus || pendingPriority)) {
        setPendingStatus(null);
        setPendingPriority(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [pendingStatus, pendingPriority]);

  if (isLoading) {
    return (
      <AppLayout>
        <div className="space-y-6 max-w-6xl mx-auto animate-pulse">
          <div className="h-5 w-32 rounded bg-muted/60" />
          <div className="rounded-2xl border border-border/40 overflow-hidden">
            <div className="h-1.5 w-full bg-muted/80" />
            <div className="p-6 md:p-8 space-y-4">
              <div className="flex gap-4">
                <div className="h-14 w-14 rounded-2xl bg-muted/60" />
                <div className="flex-1 space-y-3">
                  <div className="h-7 w-3/4 rounded bg-muted/60" />
                  <div className="h-5 w-32 rounded bg-muted/60" />
                  <div className="flex gap-2">
                    <div className="h-6 w-16 rounded-full bg-muted/60" />
                    <div className="h-6 w-20 rounded-full bg-muted/60" />
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              <div className="h-48 rounded-2xl bg-muted/40" />
              <div className="h-64 rounded-2xl bg-muted/40" />
            </div>
            <div className="space-y-5">
              <div className="h-40 rounded-2xl bg-muted/40" />
              <div className="h-56 rounded-2xl bg-muted/40" />
            </div>
          </div>
        </div>
      </AppLayout>
    );
  }
  if (isError || !ticket) return <AppLayout><div className="text-center p-8 text-destructive">Ticket not found.</div></AppLayout>;

  const isClosing = pendingStatus === 'closed';
  const ticketNum = (ticket as any).ticketNumber ?? `#${ticket.id.substring(0, 8)}`;
  const statusForBadge =
    ticket.status === "open" && (ticket.priority === "high" || ticket.priority === "critical")
      ? "open_urgent"
      : ticket.status;

  return (
    <AppLayout>
      <div className="space-y-6 max-w-6xl mx-auto">
        <Link
          href="/tickets"
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 -ml-2 text-sm font-medium text-muted-foreground hover:text-primary hover:bg-primary/5 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back to tickets
        </Link>

        {/* Priority Confirmation Dialog */}
        <Dialog open={!!pendingPriority} onOpenChange={(open) => { if (!open) setPendingPriority(null); }}>
          <DialogContent className="sm:max-w-[400px] rounded-2xl">
            <DialogHeader>
              <DialogTitle className="font-display">Change Priority?</DialogTitle>
              <DialogDescription>
                Change priority from <span className="font-medium">{PRIORITY_LABEL[ticket.priority]}</span> to <span className="font-medium">{pendingPriority ? PRIORITY_LABEL[pendingPriority] : ''}</span>? This will be logged in the activity log.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 pt-2">
              <Button variant="outline" className="rounded-xl" onClick={() => setPendingPriority(null)}>Cancel</Button>
              <Button
                className="rounded-xl"
                disabled={updateMutation.isPending || commentMutation.isPending}
                onClick={applyPriorityChange}
              >
                {(updateMutation.isPending || commentMutation.isPending) && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Confirm
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog open={!!pendingStatus} onOpenChange={(open) => { if (!open) { setPendingStatus(null); setRemarksText(""); } }}>
          <DialogContent className="sm:max-w-[460px] rounded-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 font-display">
                {isClosing && <AlertTriangle className="w-5 h-5 text-destructive" />}
                {isClosing ? 'Close Ticket?' : `Mark as ${STATUS_LABEL[pendingStatus ?? '']}`}
              </DialogTitle>
              <DialogDescription>
                {isClosing
                  ? 'This action is permanent. Closed tickets cannot be reopened. Please add a reason before confirming.'
                  : pendingStatus === 'on_hold'
                  ? 'Describe why this ticket is being put on hold (e.g. waiting on user reply, vendor, hardware delivery).'
                  : `Add remarks explaining why this ticket is being marked as "${STATUS_LABEL[pendingStatus ?? '']}".`}
              </DialogDescription>
            </DialogHeader>
            <div className="py-2">
              <Textarea
                placeholder={isClosing ? 'Reason for closing (spam, duplicate, resolved, etc.)...' : 'Describe the resolution or current state...'}
                value={remarksText}
                onChange={(e) => setRemarksText(e.target.value)}
                className="rounded-xl min-h-[100px] resize-none"
                autoFocus
              />
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" className="rounded-xl" onClick={() => { setPendingStatus(null); setRemarksText(""); }}>
                Cancel
              </Button>
              <Button
                className={`rounded-xl ${isClosing ? 'bg-destructive hover:bg-destructive/90 text-destructive-foreground' : ''}`}
                disabled={!remarksText.trim() || updateMutation.isPending || commentMutation.isPending}
                onClick={() => applyStatusChange(pendingStatus!, remarksText)}
              >
                {(updateMutation.isPending || commentMutation.isPending) && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {isClosing ? 'Confirm Close' : `Mark as ${STATUS_LABEL[pendingStatus ?? '']}`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Hero */}
        <section className="relative overflow-hidden rounded-2xl border border-primary/20 shadow-[0_8px_32px_rgba(53,88,114,0.12)]">
          <div className={cn("absolute left-0 top-0 bottom-0 w-1.5", priorityStripe(ticket.priority))} />
          <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.06] via-card to-accent/[0.04]" />
          <div
            aria-hidden
            className="absolute inset-0 opacity-[0.35]"
            style={{
              backgroundImage:
                "radial-gradient(circle at 1px 1px, rgba(53,88,114,0.06) 1px, transparent 0)",
              backgroundSize: "18px 18px",
            }}
          />

          <div className="relative flex flex-col gap-5 p-6 md:flex-row md:items-start md:justify-between md:p-8 pl-8">
            <div className="flex items-start gap-4 min-w-0">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/15 shadow-sm">
                <TicketIcon className="w-7 h-7" />
              </div>
              <div className="min-w-0">
                <h1 className="text-xl md:text-2xl font-display font-bold text-foreground leading-snug">
                  {ticket.title}
                </h1>
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <span className="font-mono text-sm text-primary font-semibold bg-primary/[0.06] border border-primary/10 px-2 py-0.5 rounded-md">
                    {ticketNum}
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyTicketNumber}
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                    title="Copy ticket number"
                  >
                    {copied ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-500" />
                        <span className="text-xs text-emerald-600">Copied</span>
                      </>
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-2 mt-3">
                  <StatusBadge status={statusForBadge} />
                  <StatusBadge status={ticket.priority} />
                  {(ticket as any).type && (ticket as any).type !== "other" && (
                    <span className="text-xs text-muted-foreground bg-muted/80 px-2.5 py-1 rounded-md border border-border/50 font-medium">
                      {TICKET_TYPE_LABEL[(ticket as any).type] ?? (ticket as any).type}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-4 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-primary/60" />
                    Opened {format(new Date(ticket.createdAt), "MMM d, yyyy h:mm a")}
                  </span>
                  {(ticket as any).resolvedAt && (
                    <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-medium">
                      Resolved {format(new Date((ticket as any).resolvedAt), "MMM d, yyyy h:mm a")}
                    </span>
                  )}
                  {(ticket as any).closedAt && (
                    <span className="flex items-center gap-1.5">
                      Closed {format(new Date((ticket as any).closedAt), "MMM d, yyyy h:mm a")}
                    </span>
                  )}
                  <span className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-[10px] ring-1 ring-primary/10">
                      {ticket.createdBy.fullName.charAt(0)}
                    </span>
                    <span>
                      by <span className="font-medium text-foreground">{ticket.createdBy.fullName}</span>
                    </span>
                  </span>
                </div>
              </div>
            </div>
            <Button variant="outline" size="sm" className="h-9 rounded-xl shrink-0 bg-card/80 backdrop-blur-sm" onClick={handlePrint} title="Print ticket">
              <Printer className="w-4 h-4 mr-1.5" /> Print
            </Button>
          </div>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            <Card className="border-border/60 shadow-sm rounded-2xl overflow-hidden">
              <CardHeader className="border-b border-border/50 bg-muted/20 py-4 px-6">
                <CardTitle className="text-base font-display flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-primary" />
                  Description
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6 md:p-8">
                <p className="whitespace-pre-wrap leading-relaxed text-foreground/90 text-[15px]">{ticket.description}</p>
              </CardContent>
            </Card>

            {/* Activity Log */}
            <div className="space-y-4">
              <h3 className="text-base font-display font-semibold flex items-center gap-2 text-foreground">
                <History className="w-5 h-5 text-primary" />
                Activity log
                <span className="text-xs font-normal text-muted-foreground bg-muted/60 px-2 py-0.5 rounded-full">
                  {ticket.comments.length} {ticket.comments.length === 1 ? "entry" : "entries"}
                </span>
              </h3>
              <div className="rounded-2xl border border-border/60 bg-card shadow-sm overflow-hidden">
                {ticket.comments.length === 0 ? (
                  <div className="px-6 py-10 text-center text-sm text-muted-foreground">
                    No activity yet. Updates and replies will appear here.
                  </div>
                ) : (
                  <div className="relative px-4 py-3">
                    <div
                      aria-hidden
                      className="absolute left-[27px] top-6 bottom-6 w-px bg-border/70"
                    />
                    <div className="space-y-1">
                      {ticket.comments.map((comment: { id: string; commentText: string; createdAt: string; createdBy: { fullName: string } }) => {
                        const isSystemEntry = /^[🔄👤🔓⬆️⬇️✅📝]/.test(comment.commentText);
                        if (isSystemEntry) {
                          return (
                            <div key={comment.id} className="relative flex gap-3 py-3 pl-1">
                              <div className="relative z-10 mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted ring-2 ring-card">
                                <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
                              </div>
                              <div className="flex-1 min-w-0 rounded-lg bg-muted/40 px-3 py-2.5">
                                <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">
                                  {comment.commentText}
                                </p>
                                <p className="text-[10px] text-muted-foreground/60 mt-1.5">
                                  {format(new Date(comment.createdAt), "MMM d, yyyy h:mm a")}
                                </p>
                              </div>
                            </div>
                          );
                        }
                        return (
                          <div key={comment.id} className="relative flex gap-3 py-3 pl-1">
                            <div className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent font-bold text-xs ring-2 ring-card">
                              {comment.createdBy.fullName.charAt(0)}
                            </div>
                            <div className="flex-1 min-w-0 rounded-xl border border-border/50 bg-background px-4 py-3 shadow-sm">
                              <div className="flex items-center justify-between gap-2 mb-2">
                                <span className="font-semibold text-sm text-foreground">
                                  {comment.createdBy.fullName}
                                </span>
                                <span className="text-xs text-muted-foreground shrink-0">
                                  {format(new Date(comment.createdAt), "MMM d, h:mm a")}
                                </span>
                              </div>
                              <p className="text-sm whitespace-pre-wrap text-foreground/90 leading-relaxed">
                                {comment.commentText}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {ticket.status !== "closed" && (
                <div className="rounded-2xl border border-primary/20 bg-gradient-to-br from-card to-primary/[0.02] shadow-sm p-5">
                  <p className="text-sm font-medium text-foreground mb-3">Add a reply</p>
                  <Textarea
                    placeholder="Type your reply here..."
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value.slice(0, MAX_COMMENT))}
                    className="min-h-[100px] mb-3 border-border/50 focus-visible:ring-primary/20 rounded-xl resize-none bg-background"
                  />
                  <div className="flex items-center justify-between">
                    <span
                      className={`text-xs ${commentText.length >= MAX_COMMENT ? "text-destructive" : "text-muted-foreground"}`}
                    >
                      {commentText.length}/{MAX_COMMENT}
                    </span>
                    <Button
                      onClick={handleAddComment}
                      disabled={!commentText.trim() || commentMutation.isPending}
                      className="rounded-xl shadow-md shadow-primary/20"
                    >
                      {commentMutation.isPending ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Send className="w-4 h-4 mr-2" />
                      )}
                      Send reply
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-5">
            {/* SLA Card */}
            <div className="rounded-2xl border border-border/60 bg-card shadow-sm overflow-hidden">
            <SLABadge
              variant="full"
              priority={ticket.priority}
              createdAt={ticket.createdAt}
              resolvedAt={(ticket as any).resolvedAt}
              closedAt={(ticket as any).closedAt}
              ticketStatus={ticket.status}
              totalHoldSeconds={(ticket as any).totalHoldSeconds}
              onHoldAt={(ticket as any).onHoldAt}
            />
            </div>

            {/* Assigned staff — visible to general users */}
            {!canManage && (
              <Card className="border-border/60 shadow-sm rounded-2xl overflow-hidden">
                <CardHeader className="border-b border-border/50 bg-muted/20 py-3.5 px-5">
                  <CardTitle className="text-sm font-display flex items-center gap-2">
                    <UserCheck className="w-4 h-4 text-primary" />
                    Assigned to
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-5 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0 font-bold text-sm ring-1 ring-primary/10">
                    {ticket.assignedTo ? ticket.assignedTo.fullName.charAt(0) : "—"}
                  </div>
                  <div>
                    {ticket.assignedTo ? (
                      <p className="text-sm font-semibold text-foreground">{ticket.assignedTo.fullName}</p>
                    ) : (
                      <p className="text-sm text-muted-foreground italic">Awaiting assignment</p>
                    )}
                    <p className="text-xs text-muted-foreground mt-0.5">Support staff member</p>
                  </div>
                </CardContent>
              </Card>
            )}

            {(canManage || (ticket.status === 'resolved' && ticket.createdBy.id === user?.id)) && (
              <Card className="border-border/60 shadow-sm rounded-2xl overflow-hidden">
                <CardHeader className="border-b border-border/50 bg-muted/20 py-4 px-6">
                  <CardTitle className="text-base font-display flex items-center gap-2">
                    <ShieldAlert className="w-5 h-5 text-primary" />
                    Ticket management
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-6 space-y-5">
                  {ticket.status === 'closed' ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-border/50 bg-muted/30 text-sm text-muted-foreground">
                        <StatusBadge status="closed" /> This ticket is closed — no further actions allowed.
                      </div>
                      {(ticket as any).satisfactionRating != null && (
                        <div className="px-3 py-3 rounded-xl border border-amber-200 dark:border-amber-800/50 bg-amber-50/50 dark:bg-amber-900/10 space-y-1.5">
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">User Satisfaction</p>
                          <div className="flex gap-1">
                            {[1,2,3,4,5].map(s => (
                              <Star key={s} className={`w-4 h-4 ${s <= (ticket as any).satisfactionRating ? 'text-amber-400 fill-amber-400' : 'text-muted-foreground/20'}`} />
                            ))}
                            <span className="text-xs text-muted-foreground ml-1 self-center">{(ticket as any).satisfactionRating}/5</span>
                          </div>
                          {(ticket as any).satisfactionComment && (
                            <p className="text-xs text-muted-foreground italic">"{(ticket as any).satisfactionComment}"</p>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      <div>
                        <Label className="mb-1.5 block">Update Status</Label>
                        <Select
                          value={ticket.status}
                          onValueChange={handleStatusSelect}
                          disabled={updateMutation.isPending || getAllowedTransitions(ticket.status, (user?.role ?? 'general_user') as Role).length === 0}
                        >
                          <SelectTrigger className="w-full rounded-xl"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value={ticket.status} disabled>
                              {STATUS_LABEL[ticket.status]} (current)
                            </SelectItem>
                            {getAllowedTransitions(ticket.status, (user?.role ?? 'general_user') as Role).map(s => (
                              <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {isAdmin && (
                        <div>
                          <Label className="mb-1.5 block">Priority</Label>
                          <Select
                            value={ticket.priority}
                            onValueChange={(val) => { if (val !== ticket.priority) setPendingPriority(val); }}
                            disabled={updateMutation.isPending}
                          >
                            <SelectTrigger className="w-full rounded-xl"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {['critical', 'high', 'medium', 'low'].map(p => (
                                <SelectItem key={p} value={p}>{PRIORITY_LABEL[p]}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}

                      {isAdmin && (
                        <div>
                          <Label className="mb-1.5 block">Type</Label>
                          <Select
                            value={(ticket as any).type ?? 'other'}
                            onValueChange={(val) => {
                              if (val !== (ticket as any).type) {
                                updateMutation.mutate({ id, data: { type: val } as any });
                              }
                            }}
                            disabled={updateMutation.isPending}
                          >
                            <SelectTrigger className="w-full rounded-xl"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {Object.values(TicketType).map(t => (
                                <SelectItem key={t} value={t}>{TICKET_TYPE_LABEL[t]}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}

                      {canManage && (
                        <div>
                          <Label className="mb-1.5 flex items-center gap-1.5">
                            <UserCheck className="w-4 h-4 text-primary" /> Assign To
                          </Label>
                          <Select
                            value={ticket.assignedTo?.id ?? "unassigned"}
                            onValueChange={(v) => handleAssign(v === "unassigned" ? null : v)}
                            disabled={updateMutation.isPending || ticket.status === "resolved"}
                          >
                            <SelectTrigger className="w-full rounded-xl"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="unassigned">Unassigned</SelectItem>
                              {rankedStaff
                                .filter((s) => (s as { isActive?: boolean }).isActive !== false)
                                .map((s, i) => {
                                const load = staffWorkload.find(w => w.id === s.id)?.totalActive ?? 0;
                                const isRecommended = i === 0 && load === Math.min(...rankedStaff.map(r => staffWorkload.find(w => w.id === r.id)?.totalActive ?? 0));
                                return (
                                  <SelectItem key={s.id} value={s.id}>
                                    <span className="flex items-center gap-2">
                                      {s.fullName}
                                      <span className="text-xs text-muted-foreground">({load} active)</span>
                                      {isRecommended && <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">★ Suggested</span>}
                                    </span>
                                  </SelectItem>
                                );
                              })}
                            </SelectContent>
                          </Select>
                          {rankedStaff.length > 0 && !ticket.assignedTo && (
                            <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1">
                              ★ Suggested based on current workload
                            </p>
                          )}
                          {isSupport && ticket.status === "open" && ticket.assignedTo?.id !== user?.id && (
                            <Button
                              variant="outline"
                              className="mt-2 w-full rounded-xl"
                              disabled={updateMutation.isPending}
                              onClick={() => handleAssign(user!.id)}
                            >
                              {updateMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <UserCheck className="w-4 h-4 mr-2" />}
                              Assign to Me
                            </Button>
                          )}
                        </div>
                      )}

                      {ticket.assignedTo && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground pt-1 border-t border-border/50">
                          <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-xs">
                            {ticket.assignedTo.fullName.charAt(0)}
                          </div>
                          <span>Assigned to <span className="font-medium text-foreground">{ticket.assignedTo.fullName}</span></span>
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            )}

            {ticket.asset && (
              <Card className="border-border/60 shadow-sm rounded-2xl overflow-hidden group">
                <div className="bg-gradient-to-br from-primary/8 via-primary/5 to-accent/5 p-5 border-b border-border/50 flex justify-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/15 group-hover:scale-105 transition-transform duration-300">
                    <MonitorSmartphone className="w-8 h-8" />
                  </div>
                </div>
                <CardContent className="p-6 space-y-4">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                      Related asset
                    </p>
                    <h4 className="font-bold font-display text-lg leading-tight">{ticket.asset.name}</h4>
                  </div>
                  <div className="space-y-2.5 text-sm rounded-xl bg-muted/40 p-3.5">
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">Tag</span>
                      <span className="font-mono font-medium bg-background px-1.5 py-0.5 rounded border border-border/50">
                        {ticket.asset.assetTag}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">Category</span>
                      <span className="capitalize font-medium">{ticket.asset.category}</span>
                    </div>
                    <div className="flex justify-between items-center gap-2">
                      <span className="text-muted-foreground">Status</span>
                      <StatusBadge status={ticket.asset.status} />
                    </div>
                  </div>
                </CardContent>
                {canManage && (
                  <CardFooter className="p-4 pt-0 border-t border-border/50 mt-4 bg-muted/10">
                    <Link href={`/assets/${ticket.asset.id}`} className="w-full">
                      <Button variant="outline" className="w-full rounded-xl">View Asset Details</Button>
                    </Link>
                  </CardFooter>
                )}
              </Card>
            )}

            {/* Satisfaction Rating — shown to ticket creator when resolved/closed */}
            {(() => {
              const isCreator = ticket.createdBy.id === user?.id;
              const isDone = ticket.status === 'resolved' || ticket.status === 'closed';
              const alreadyRated = (ticket as any).satisfactionRating != null;
              if (!isCreator || !isDone) return null;
              if (alreadyRated) {
                const rating = (ticket as any).satisfactionRating as number;
                return (
                  <Card className="border-border/60 shadow-sm rounded-2xl">
                    <CardHeader className="border-b border-border/50 py-4 px-6">
                      <CardTitle className="text-base font-display flex items-center gap-2">
                        <Star className="w-5 h-5 text-amber-400 fill-amber-400" /> Your Rating
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-6 space-y-3">
                      <div className="flex gap-1">
                        {[1,2,3,4,5].map(s => (
                          <Star key={s} className={`w-6 h-6 ${s <= rating ? 'text-amber-400 fill-amber-400' : 'text-muted-foreground/30'}`} />
                        ))}
                      </div>
                      {(ticket as any).satisfactionComment && (
                        <p className="text-sm text-muted-foreground italic">"{(ticket as any).satisfactionComment}"</p>
                      )}
                    </CardContent>
                  </Card>
                );
              }
              return (
                <Card className="border-amber-200 dark:border-amber-800/50 shadow-lg shadow-black/5 rounded-2xl">
                  <CardHeader className="border-b border-border/50 py-4 px-6">
                    <CardTitle className="text-base font-display flex items-center gap-2">
                      <Star className="w-5 h-5 text-amber-400" /> Rate this Resolution
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-6 space-y-4">
                    <p className="text-sm text-muted-foreground">How satisfied are you with how this ticket was handled?</p>
                    <div className="flex gap-1.5">
                      {[1,2,3,4,5].map(s => (
                        <button
                          key={s}
                          onMouseEnter={() => setHoverRating(s)}
                          onMouseLeave={() => setHoverRating(0)}
                          onClick={() => setSelectedRating(s)}
                          className="transition-transform hover:scale-110"
                        >
                          <Star className={`w-8 h-8 transition-colors ${s <= (hoverRating || selectedRating) ? 'text-amber-400 fill-amber-400' : 'text-muted-foreground/30'}`} />
                        </button>
                      ))}
                    </div>
                    {selectedRating > 0 && (
                      <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
                        {['', 'Very Dissatisfied', 'Dissatisfied', 'Neutral', 'Satisfied', 'Very Satisfied'][selectedRating]}
                      </p>
                    )}
                    <Textarea
                      placeholder="Optional comment..."
                      value={satisfactionComment}
                      onChange={e => setSatisfactionComment(e.target.value)}
                      className="rounded-xl min-h-[70px] resize-none text-sm"
                    />
                    <Button
                      className="w-full rounded-xl"
                      disabled={!selectedRating || satisfactionMutation.isPending}
                      onClick={handleSubmitRating}
                    >
                      {satisfactionMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Star className="w-4 h-4 mr-2" />}
                      Submit Rating
                    </Button>
                  </CardContent>
                </Card>
              );
            })()}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

