import { useState, useEffect, useMemo } from "react";
import { Link, useSearch } from "wouter";
import { useGetTickets, useCreateTicket, useGetSupportStaff, useGetUsers, TicketPriority, TicketType, TICKET_TYPE_LABEL, useGetAssets } from "@/lib/supabase-queries";
import { useAuth } from "@/lib/auth-context";
import { AppLayout } from "@/components/layout/app-layout";
import { StatusBadge } from "@/components/ui/status-badge";
import { PaginationBar } from "@/components/ui/pagination-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Search, Plus, Loader2, TicketIcon, X, FilePlus, ChevronsUpDown, Check } from "lucide-react";
import { format, formatDistanceToNow, isToday, isYesterday } from "date-fns";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { SLABadge } from "@/components/ui/sla-badge";
import { SkeletonTable } from "@/components/ui/skeleton-table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";

function formatTicketDate(dateStr: string): { relative: string; full: string } {
  const d = new Date(dateStr);
  const full = format(d, 'MMM d, yyyy h:mm a');
  let relative: string;
  if (isToday(d)) relative = formatDistanceToNow(d, { addSuffix: true });
  else if (isYesterday(d)) relative = `Yesterday ${format(d, 'h:mm a')}`;
  else relative = format(d, 'MMM d, yyyy');
  return { relative, full };
}

const PAGE_SIZE = 25;

const PRIORITY_LABEL: Record<string, string> = {
  critical: 'Critical - 1', high: 'High - 2', medium: 'Medium - 3', low: 'Low - 4',
};

const STATUS_LABEL: Record<string, string> = {
  open: 'Open', in_progress: 'In Progress', on_hold: 'On Hold',
  resolved: 'Resolved', closed: 'Closed',
};

function getRowHighlight(status: string, priority: string): string {
  if (status === 'closed')      return 'bg-gray-100/60 dark:bg-gray-800/20 hover:bg-gray-100/80 dark:hover:bg-gray-800/30';
  if (status === 'resolved')    return 'bg-green-50/70 dark:bg-green-900/10 hover:bg-green-50 dark:hover:bg-green-900/20';
  if (status === 'in_progress') return 'bg-blue-50/70 dark:bg-blue-900/10 hover:bg-blue-50 dark:hover:bg-blue-900/20';
  if (status === 'on_hold')     return 'bg-neutral-200/60 dark:bg-neutral-700/20 hover:bg-neutral-200/80 dark:hover:bg-neutral-700/30';
  if (status === 'open') {
    if (priority === 'high' || priority === 'critical')
      return 'bg-orange-50/70 dark:bg-orange-900/10 hover:bg-orange-50 dark:hover:bg-orange-900/20';
    return 'bg-yellow-50/70 dark:bg-yellow-900/10 hover:bg-yellow-50 dark:hover:bg-yellow-900/20';
  }
  return 'hover:bg-muted/30';
}

const createTicketSchema = z.object({
  title: z.string().trim().min(1, "Title is required"),
  description: z.string().trim().min(1, "Description is required"),
  priority: z.nativeEnum(TicketPriority),
  type: z.nativeEnum(TicketType),
  assetId: z.string().optional().nullable(),
});

export default function TicketsList() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isAdmin = user?.role === 'administrator';
  const isSupport = user?.role === 'support_staff';

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [resolvedClosed, setResolvedClosed] = useState(false); // true = show resolved+closed together
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");
  const [scope, setScope] = useState<"mine" | "all">(isAdmin ? "all" : "mine");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [createSuccess, setCreateSuccess] = useState(false);
  const [assetComboOpen, setAssetComboOpen] = useState(false);

  // Keyboard shortcut: N = new ticket, / = focus search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); setIsDialogOpen(true); }
      if (e.key === '/') { e.preventDefault(); document.querySelector<HTMLInputElement>('input[placeholder*="Search"]')?.focus(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Read ?status=, ?scope= and ?assignedTo= from URL on mount (e.g. from dashboard card links)
  const searchString = useSearch();
  useEffect(() => {
    const params = new URLSearchParams(searchString);
    const s = params.get("status");
    const sc = params.get("scope");
    const at = params.get("assignedTo");

    // resolved_closed is a virtual status meaning both resolved and closed —
    // we show all when that value is present by leaving statusFilter as "all"
    // but the query will include both; use "resolved" as the nearest single filter
    // since the tickets page doesn't support multi-status. We set it to "all" and
    // let the user see both resolved and closed naturally.
    if (s === "resolved_closed") {
      setResolvedClosed(true);
      setStatusFilter("all");
    } else if (s && Object.keys(STATUS_LABEL).includes(s)) {
      setResolvedClosed(false);
      setStatusFilter(s);
    } else if (!s) {
      setResolvedClosed(false);
      setStatusFilter("all");
    }

    // ?assignedTo=<userId> — admin "Assigned to Me" ticket card
    if (at && isAdmin) {
      setAssigneeFilter(at);
      setScope("all");
    } else if (sc === "mine") {
      setScope("mine");
    } else if (sc === "all") {
      setScope("all");
    } else if (!sc && isAdmin) {
      setScope("all");
    }
  }, [searchString]);

  const { data: assets } = useGetAssets();
  const { data: supportStaff } = useGetSupportStaff();
  // All assignable staff — support staff + administrators, sorted by name
  const { data: allUsers } = useGetUsers();
  const assignableStaff = (allUsers ?? [])
    .filter(u => u.role === 'support_staff' || u.role === 'administrator')
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
  const createMutation = useCreateTicket();

  const queryFilters: any = {
    search: search || undefined,
    status: statusFilter !== "all" ? statusFilter as any : undefined,
    priority: priorityFilter !== "all" ? priorityFilter as any : undefined,
  };
  if (isAdmin && assigneeFilter !== "all" && assigneeFilter !== "unassigned") queryFilters.assignedTo = assigneeFilter;
  if (scope === "mine") {
    // Only apply personal filter when no explicit assignee filter is active
    if (isAdmin && assigneeFilter === "all") queryFilters.assignedTo = user?.id;
    else if (!isAdmin && !isSupport) queryFilters.createdBy = user?.id;
    else if (isSupport) queryFilters.assignedTo = user?.id;
  }

  const { data, isLoading } = useGetTickets({ query: queryFilters });

  // Reset to page 1 when filters change
  useEffect(() => { setPage(1); }, [search, statusFilter, resolvedClosed, priorityFilter, assigneeFilter, scope]);

  const allTickets = useMemo(() => {
    let base = data?.data ?? [];
    // Multi-status filter: resolved + closed together (from dashboard "Resolved & Closed" card)
    if (resolvedClosed) {
      base = base.filter(t => t.status === 'resolved' || t.status === 'closed');
    }
    if (isAdmin && assigneeFilter === "unassigned") {
      base = base.filter(t => !t.assignedTo);
    }
    return base;
  }, [data, isAdmin, assigneeFilter, resolvedClosed]);
  const pagedTickets = allTickets.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const form = useForm<z.infer<typeof createTicketSchema>>({
    resolver: zodResolver(createTicketSchema),
    defaultValues: { title: "", description: "", priority: "low" as TicketPriority, type: "other" as TicketType, assetId: null },
  });

  const onSubmit = async (values: z.infer<typeof createTicketSchema>) => {
    try {
      await createMutation.mutateAsync({ data: {
        ...values,
        title: values.title.trim(),
        description: values.description.trim(),
      }});
      setCreateSuccess(true);
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      setTimeout(() => {
        setIsDialogOpen(false);
        setCreateSuccess(false);
        form.reset();
      }, 1200);
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error", description: error.message || "Failed to create ticket." });
    }
  };

  const hasActiveFilters = statusFilter !== "all" || resolvedClosed || priorityFilter !== "all" || (isAdmin && assigneeFilter !== "all") || search;

  return (
    <AppLayout>
      <div className="space-y-4">
        {/* Page header: scope toggle aligned with header title */}
        {!isAdmin && (
          <div className="flex justify-end">
            <div className="flex rounded-xl border border-border/50 overflow-hidden h-9">
              <button
                onClick={() => setScope("mine")}
                className={`px-4 text-sm font-medium transition-colors ${scope === "mine" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted"}`}
              >
                {isSupport ? "Assigned to Me" : "My Tickets"}
              </button>
              <button
                onClick={() => setScope("all")}
                className={`px-4 text-sm font-medium transition-colors ${scope === "all" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted"}`}
              >
                All Tickets
              </button>
            </div>
          </div>
        )}

        {/* Top bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">

          {/* Search + New Ticket */}
          <div className="flex items-center gap-2 w-full max-w-xl">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by title, ticket no., or requester..."
                value={search}
                onChange={(e) => {
                  const val = e.target.value;
                  setSearch(val);
                  if (val) {
                    setStatusFilter("all");
                    setResolvedClosed(false);
                    setPriorityFilter("all");
                    if (!isAdmin) setScope("all");
                  }
                }}
                className="pl-9 h-10 rounded-xl bg-card border-border/50 shadow-sm text-sm"
              />
            </div>
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button className="h-10 rounded-xl bg-primary hover:bg-primary/90 shadow-md shadow-primary/20 shrink-0">
                  <Plus className="w-4 h-4 mr-2" /> New Ticket
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[550px] p-0 border-0 shadow-2xl rounded-2xl">
                <div className="px-6 py-6 bg-muted/30 border-b border-border">
                  <DialogHeader>
                    <DialogTitle className="text-2xl font-display">Create Support Ticket</DialogTitle>
                    <DialogDescription>Describe your issue or request.</DialogDescription>
                  </DialogHeader>
                </div>
                <div className="p-6">
                  <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
                      <FormField control={form.control} name="title" render={({ field }) => (
                        <FormItem><FormLabel>Summary</FormLabel><FormControl><Input placeholder="Brief title of the issue" {...field} className="rounded-xl" /></FormControl><FormMessage /></FormItem>
                      )} />
                      <div className="grid grid-cols-2 gap-4">
                        <FormField control={form.control} name="priority" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Priority</FormLabel>
                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                              <FormControl><SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger></FormControl>
                              <SelectContent>
                                {Object.values(TicketPriority).map(p => <SelectItem key={p} value={p}>{PRIORITY_LABEL[p]}</SelectItem>)}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={form.control} name="type" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Type</FormLabel>
                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                              <FormControl><SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger></FormControl>
                              <SelectContent>
                                {Object.values(TicketType).map(t => <SelectItem key={t} value={t}>{TICKET_TYPE_LABEL[t]}</SelectItem>)}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={form.control} name="assetId" render={({ field }) => (
                          <FormItem className="col-span-2">
                            <FormLabel>Related Asset (Optional)</FormLabel>
                            <Popover open={assetComboOpen} onOpenChange={setAssetComboOpen}>
                              <PopoverTrigger asChild>
                                <FormControl>
                                  <Button
                                    variant="outline"
                                    role="combobox"
                                    className={cn("w-full rounded-xl justify-between font-normal h-10", !field.value && "text-muted-foreground")}
                                  >
                                    {field.value
                                      ? (() => { const a = assets?.data?.find(a => a.id === field.value); return a ? `${a.name} (${a.assetTag})` : "Select asset..."; })()
                                      : "None — search by name, tag, or category"}
                                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                  </Button>
                                </FormControl>
                              </PopoverTrigger>
                              <PopoverContent className="w-[--radix-popover-trigger-width] p-0 rounded-xl" align="start">
                                <Command>
                                  <CommandInput placeholder="Search by name, tag, or category..." className="h-9" />
                                  <CommandList>
                                    <CommandEmpty>No assets found.</CommandEmpty>
                                    <CommandGroup>
                                      <CommandItem
                                        value="none"
                                        onSelect={() => { field.onChange(null); setAssetComboOpen(false); }}
                                        className="text-muted-foreground"
                                      >
                                        <Check className={cn("mr-2 h-4 w-4", !field.value ? "opacity-100" : "opacity-0")} />
                                        None
                                      </CommandItem>
                                      {assets?.data?.map(a => (
                                        <CommandItem
                                          key={a.id}
                                          value={`${a.name} ${a.assetTag} ${a.category}`}
                                          onSelect={() => { field.onChange(a.id); setAssetComboOpen(false); }}
                                        >
                                          <Check className={cn("mr-2 h-4 w-4", field.value === a.id ? "opacity-100" : "opacity-0")} />
                                          <span className="font-medium">{a.name}</span>
                                          <span className="ml-1.5 text-muted-foreground text-xs">({a.assetTag})</span>
                                        </CommandItem>
                                      ))}
                                    </CommandGroup>
                                  </CommandList>
                                </Command>
                              </PopoverContent>
                            </Popover>
                            <FormMessage />
                          </FormItem>
                        )} />
                      </div>
                      <FormField control={form.control} name="description" render={({ field }) => (
                        <FormItem><FormLabel>Description</FormLabel><FormControl><Textarea placeholder="Detailed explanation..." {...field} className="rounded-xl min-h-[120px]" /></FormControl><FormMessage /></FormItem>
                      )} />
                      <div className="pt-4 flex justify-end gap-3">
                        <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)} className="rounded-xl">Cancel</Button>
                        {createSuccess ? (
                          <Button disabled className="rounded-xl bg-emerald-600 text-white gap-2">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                            Ticket Submitted!
                          </Button>
                        ) : (
                          <Button type="submit" disabled={createMutation.isPending} className="rounded-xl shadow-md shadow-primary/20">
                            {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Submit Ticket
                          </Button>
                        )}
                      </div>
                    </form>
                  </Form>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {/* Filters */}
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={resolvedClosed ? "resolved_closed" : statusFilter} onValueChange={v => {
              if (v === "resolved_closed") {
                setResolvedClosed(true);
                setStatusFilter("all");
              } else {
                setResolvedClosed(false);
                setStatusFilter(v);
              }
            }}>
              <SelectTrigger className="h-10 w-[160px] rounded-xl text-sm border-border/50">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {Object.keys(STATUS_LABEL).map(s => (
                  <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
                ))}
                <SelectItem value="resolved_closed">Resolved & Closed</SelectItem>
              </SelectContent>
            </Select>

            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger className="h-10 w-[140px] rounded-xl text-sm border-border/50">
                <SelectValue placeholder="Priority" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Priorities</SelectItem>
                {Object.values(TicketPriority).map(p => (
                  <SelectItem key={p} value={p}>{PRIORITY_LABEL[p]}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {isAdmin && (
              <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
                <SelectTrigger className="h-10 w-[160px] rounded-xl text-sm border-border/50">
                  <SelectValue placeholder="Assigned To" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Assignees</SelectItem>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {assignableStaff.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.fullName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {hasActiveFilters && (
              <Button variant="ghost" size="sm" className="h-10 px-3 rounded-xl text-muted-foreground"
                onClick={() => { setSearch(""); setStatusFilter("all"); setResolvedClosed(false); setPriorityFilter("all"); setAssigneeFilter("all"); }}>
                <X className="w-4 h-4 mr-1" /> Clear
              </Button>
            )}
          </div>
        </div>

        {/* Active filter chips */}
        {hasActiveFilters && (
          <div className="flex gap-2 flex-wrap">
            {search && <Badge variant="secondary" className="rounded-lg">Search: "{search}"</Badge>}
            {resolvedClosed && <Badge variant="secondary" className="rounded-lg">Status: Resolved &amp; Closed</Badge>}
            {!resolvedClosed && statusFilter !== "all" && <Badge variant="secondary" className="rounded-lg">Status: {STATUS_LABEL[statusFilter]}</Badge>}
            {priorityFilter !== "all" && <Badge variant="secondary" className="rounded-lg">Priority: {PRIORITY_LABEL[priorityFilter]}</Badge>}
            {isAdmin && assigneeFilter !== "all" && (
              <Badge variant="secondary" className="rounded-lg">
                Assigned To: {assigneeFilter === "unassigned" ? "Unassigned" : assignableStaff.find(s => s.id === assigneeFilter)?.fullName ?? assigneeFilter}
              </Badge>
            )}
          </div>
        )}

        {/* Table */}
        <div className="bg-card rounded-2xl shadow-lg shadow-black/5 border border-border/50 overflow-hidden">
          {isLoading ? (
            <SkeletonTable rows={6} cols={7} />
          ) : !allTickets.length ? (
            <div className="p-16 flex flex-col items-center justify-center text-center">
              <div className="w-20 h-20 rounded-2xl bg-muted flex items-center justify-center mb-4">
                <TicketIcon className="w-10 h-10 text-muted-foreground/50" />
              </div>
              <h3 className="text-xl font-bold text-foreground mb-2">
                {hasActiveFilters ? "No tickets match your filters" : "No tickets yet"}
              </h3>
              <p className="text-muted-foreground text-sm mb-6 max-w-xs">
                {hasActiveFilters
                  ? "Try adjusting your filters or clearing the search."
                  : isAdmin || isSupport
                  ? "No support tickets have been submitted yet."
                  : "You haven't submitted any support tickets yet. Create one to get help from the IT team."}
              </p>
              {!hasActiveFilters && !isAdmin && (
                <Button className="rounded-xl gap-2" onClick={() => setIsDialogOpen(true)}>
                  <FilePlus className="w-4 h-4" /> Create First Ticket
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/30">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="font-semibold text-foreground/80 py-4 px-6">Ticket</TableHead>
                    <TableHead className="font-semibold text-foreground/80">Status & Priority</TableHead>
                    <TableHead className="font-semibold text-foreground/80">SLA</TableHead>
                    <TableHead className="font-semibold text-foreground/80">Requester</TableHead>
                    <TableHead className="font-semibold text-foreground/80">Assigned To</TableHead>
                    <TableHead className="font-semibold text-foreground/80">Created</TableHead>
                    <TableHead className="font-semibold text-foreground/80 text-right px-6">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagedTickets.map((ticket) => (
                    <TableRow key={ticket.id} className={`transition-colors group ${getRowHighlight(ticket.status, ticket.priority)}`}>
                      <TableCell className="px-6 py-4">
                        <div className="flex flex-col max-w-[280px]">
                          <span className="font-semibold text-foreground truncate" title={ticket.title}>{ticket.title}</span>
                          <span className="text-xs text-muted-foreground font-mono mt-1">{(ticket as any).ticketNumber ?? `#${ticket.id.substring(0, 8)}`}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col items-start gap-1.5">
                          <StatusBadge status={ticket.status === 'open' && (ticket.priority === 'high' || ticket.priority === 'critical') ? 'open_urgent' : ticket.status} />
                          <StatusBadge status={ticket.priority} />
                          {(ticket as any).type && (ticket as any).type !== 'other' && (
                            <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-md border border-border/50">
                              {TICKET_TYPE_LABEL[(ticket as any).type] ?? (ticket as any).type}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <SLABadge variant="compact" priority={ticket.priority} createdAt={ticket.createdAt} resolvedAt={(ticket as any).resolvedAt} closedAt={(ticket as any).closedAt} ticketStatus={ticket.status} totalHoldSeconds={(ticket as any).totalHoldSeconds} onHoldAt={(ticket as any).onHoldAt} />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-accent/10 text-accent flex items-center justify-center text-xs font-bold">
                            {ticket.createdBy.fullName.charAt(0)}
                          </div>
                          <span className="text-sm font-medium">{ticket.createdBy.fullName}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {ticket.assignedTo ? (
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">
                              {ticket.assignedTo.fullName.charAt(0)}
                            </div>
                            <span className="text-sm font-medium">{ticket.assignedTo.fullName}</span>
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {(() => { const { relative, full } = formatTicketDate(ticket.createdAt); return <span title={full}>{relative}</span>; })()}
                      </TableCell>
                      <TableCell className="text-right px-6">
                        <Link href={`/tickets/${ticket.id}`}>
                          <Button variant="outline" size="sm" className="rounded-lg shadow-sm hover:bg-primary hover:text-primary-foreground hover:border-primary transition-all">
                            View
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <PaginationBar page={page} pageSize={PAGE_SIZE} total={allTickets.length} onPage={setPage} />
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}

