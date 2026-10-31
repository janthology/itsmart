import { useState, useEffect, useMemo, useCallback, memo } from "react";
import { useSearch } from "wouter";
import { useGetTickets, useGetTicketSummary, useCreateTicket, useGetUsers, TicketPriority, TicketType, TICKET_TYPE_LABEL, useGetAssets, type TicketQueryFilters } from "@/lib/supabase-queries";
import { useAuth } from "@/lib/auth-context";
import { AppLayout } from "@/components/layout/app-layout";
import { PaginationBar } from "@/components/ui/pagination-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Loader2, TicketIcon, X, FilePlus, ChevronsUpDown, Check } from "lucide-react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import {
  TicketSummaryStrip,
  getActiveTicketFilter,
  applyTicketFilter,
} from "@/components/tickets/ticket-summary-strip";
import { TicketInventoryList } from "@/components/tickets/ticket-inventory-list";
import { TicketToolbar } from "@/components/tickets/ticket-toolbar";
import type { TicketCardData } from "@/components/tickets/ticket-card";

const PAGE_SIZE = 25;

const PRIORITY_LABEL: Record<string, string> = {
  critical: 'Critical - 1', high: 'High - 2', medium: 'Medium - 3', low: 'Low - 4',
};

const STATUS_LABEL: Record<string, string> = {
  open: 'Open', in_progress: 'In Progress', on_hold: 'On Hold',
  resolved: 'Resolved', closed: 'Closed',
};

const createTicketSchema = z.object({
  title: z.string().trim().min(1, "Title is required"),
  description: z.string().trim().min(1, "Description is required"),
  priority: z.nativeEnum(TicketPriority),
  type: z.nativeEnum(TicketType),
  assetId: z.string().optional().nullable(),
});

interface TicketGroupSectionProps {
  title: string;
  subtitle: string;
  emptyMessage: string;
  tickets: TicketCardData[];
  typeLabels: Record<string, string>;
  /** When set, `tickets` is already the current server page and this is the real total. */
  serverTotal?: number;
  page?: number;
  onPageChange?: (page: number) => void;
}

const TicketGroupSection = memo(function TicketGroupSection({
  title,
  subtitle,
  emptyMessage,
  tickets,
  typeLabels,
  serverTotal,
  page,
  onPageChange,
}: TicketGroupSectionProps) {
  const [groupPage, setGroupPage] = useState(1);
  const serverPaged = serverTotal !== undefined;
  const totalForPaging = serverTotal ?? tickets.length;
  const totalPages = Math.max(1, Math.ceil(totalForPaging / PAGE_SIZE));
  const safePage = Math.min(page ?? groupPage, totalPages);
  const visibleTickets = serverPaged
    ? tickets
    : tickets.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  useEffect(() => {
    if (!serverPaged) setGroupPage(1);
  }, [title, tickets.length, serverPaged]);

  return (
    <section aria-label={title} className="space-y-4">
      <TicketInventoryList
        tickets={visibleTickets}
        total={totalForPaging}
        typeLabels={typeLabels}
        title={title}
        subtitle={subtitle}
        emptyMessage={emptyMessage}
      />
      {totalForPaging > PAGE_SIZE && (
        <div className="overflow-hidden rounded-2xl border border-border/50 bg-card/70 shadow-sm">
          <PaginationBar
            page={safePage}
            pageSize={PAGE_SIZE}
            total={totalForPaging}
            onPage={onPageChange ?? setGroupPage}
          />
        </div>
      )}
    </section>
  );
});

interface PagedTicketGroupProps {
  userId: string;
  mode: "assigned" | "submitted";
  filters: TicketQueryFilters;
  typeLabels: Record<string, string>;
}

/**
 * One personal-queue section ("Assigned to me" / "Submitted by me") backed
 * by its own server-paged query, so the personal view never downloads the
 * whole assigned-or-submitted union just to slice it in the browser.
 */
const PagedTicketGroup = memo(function PagedTicketGroup({
  userId,
  mode,
  filters,
  typeLabels,
}: PagedTicketGroupProps) {
  const [groupPage, setGroupPage] = useState(1);

  useEffect(() => {
    setGroupPage(1);
  }, [filters.search, filters.status, filters.lifecycle, filters.priority]);

  // The parent "My tickets" filters carry relatedTo=<me>; each section
  // narrows that union to just one side, so the union scope is dropped here.
  const { relatedTo: _relatedTo, assignedTo: _assignedTo, createdBy: _createdBy, ...sectionFilters } = filters;

  const { data, isLoading } = useGetTickets({
    query: {
      ...sectionFilters,
      ...(mode === "assigned" ? { assignedTo: userId } : { createdBy: userId }),
      page: groupPage,
      pageSize: PAGE_SIZE,
    },
  });

  const copy =
    mode === "assigned"
      ? {
          title: "Assigned to me",
          subtitle: "Support tickets assigned to you",
          emptyMessage: "No tickets are currently assigned to you.",
        }
      : {
          title: "Submitted by me",
          subtitle: "Support tickets you submitted",
          emptyMessage: "You have not submitted any support tickets.",
        };

  if (isLoading && !data) {
    return (
      <section aria-label={copy.title} className="space-y-2 rounded-3xl border border-border/60 bg-card/60 p-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[72px] rounded-xl bg-muted/40 animate-pulse" />
        ))}
      </section>
    );
  }

  return (
    <TicketGroupSection
      {...copy}
      tickets={(data?.data ?? []) as TicketCardData[]}
      serverTotal={data?.total ?? 0}
      page={groupPage}
      onPageChange={setGroupPage}
      typeLabels={typeLabels}
    />
  );
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
  // All assignable staff — support staff + administrators, sorted by name.
  // Memoized so memoized children (toolbar) receive a stable reference.
  const { data: allUsers } = useGetUsers();
  const assignableStaff = useMemo(
    () =>
      (allUsers ?? [])
        .filter(u => u.role === 'support_staff' || u.role === 'administrator')
        .sort((a, b) => a.fullName.localeCompare(b.fullName)),
    [allUsers]
  );
  const createMutation = useCreateTicket();

  // Status state maps to server-side filters: "Resolved" is a lifecycle
  // filter (it also includes tickets that were resolved before being
  // closed), and resolvedClosed is the combined Resolved + Closed view.
  const statusServerFilters: Pick<TicketQueryFilters, "status" | "lifecycle"> = resolvedClosed
    ? { lifecycle: "resolved_closed" }
    : statusFilter === "resolved"
      ? { lifecycle: "resolved" }
      : statusFilter !== "all"
        ? { status: statusFilter as TicketQueryFilters["status"] }
        : {};

  const queryFilters: TicketQueryFilters = {
    search: search || undefined,
    ...statusServerFilters,
    priority: priorityFilter !== "all" ? (priorityFilter as TicketQueryFilters["priority"]) : undefined,
  };
  if (isAdmin && assigneeFilter !== "all" && assigneeFilter !== "unassigned") queryFilters.assignedTo = assigneeFilter;
  if (isAdmin && assigneeFilter === "unassigned") queryFilters.unassigned = true;
  if (scope === "mine") {
    // Only apply personal filter when no explicit assignee filter is active.
    // Administrators and support staff get the union of tickets assigned to
    // them and tickets they submitted; the render layer separates that union
    // into groups, each with its own server-paged query.
    if ((isAdmin || isSupport) && assigneeFilter === "all") queryFilters.relatedTo = user?.id;
    else if (!isAdmin && !isSupport) queryFilters.createdBy = user?.id;
    else if (isSupport) queryFilters.assignedTo = user?.id;
  }

  const showPersonalTicketGroups =
    (isAdmin || isSupport) && scope === "mine" && assigneeFilter === "all" && Boolean(user?.id);

  // Main list: one server page at a time (skipped entirely in the grouped
  // personal view, whose sections run their own paged queries).
  const { data, isLoading } = useGetTickets({
    query: { ...queryFilters, page, pageSize: PAGE_SIZE },
    enabled: !showPersonalTicketGroups,
  });
  const listTickets = data?.data ?? [];
  const listTotal = data?.total ?? 0;

  // Queue mix uses scope-only counts — not narrowed by status, priority, or
  // search — computed with exact head-count queries, no row downloads.
  const summaryQueryFilters: Pick<TicketQueryFilters, "assignedTo" | "createdBy" | "relatedTo" | "unassigned"> = {};
  if (isAdmin && assigneeFilter !== "all" && assigneeFilter !== "unassigned") {
    summaryQueryFilters.assignedTo = assigneeFilter;
  }
  if (isAdmin && assigneeFilter === "unassigned") summaryQueryFilters.unassigned = true;
  if (scope === "mine") {
    if ((isAdmin || isSupport) && assigneeFilter === "all") summaryQueryFilters.relatedTo = user?.id;
    else if (!isAdmin && !isSupport) summaryQueryFilters.createdBy = user?.id;
    else if (isSupport) summaryQueryFilters.assignedTo = user?.id;
  }
  const { data: summaryData } = useGetTicketSummary({ query: summaryQueryFilters });

  // Reset to page 1 when filters change
  useEffect(() => { setPage(1); }, [search, statusFilter, resolvedClosed, priorityFilter, assigneeFilter, scope]);

  const summary = useMemo(
    () => ({
      total: summaryData?.total ?? 0,
      open: summaryData?.open ?? 0,
      inProgress: summaryData?.inProgress ?? 0,
      onHold: summaryData?.onHold ?? 0,
      resolved: summaryData?.resolved ?? 0,
      closed: summaryData?.closed ?? 0,
      resolvedBeforeClosed: summaryData?.resolvedBeforeClosed ?? 0,
      resolvedClosed: summaryData?.resolvedClosed ?? 0,
    }),
    [summaryData]
  );

  /** Ticket count shown in the page header for the current view. */
  const headerTicketCount = showPersonalTicketGroups ? summary.total : listTotal;

  const activeStatusFilter = getActiveTicketFilter(statusFilter, resolvedClosed);

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
      queryClient.invalidateQueries({ queryKey: ['ticketSummary'] });
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

  const handleStripFilter = useCallback((filter: ReturnType<typeof getActiveTicketFilter>) => {
    const next = applyTicketFilter(filter);
    setStatusFilter(next.statusFilter);
    setResolvedClosed(next.resolvedClosed);
  }, []);

  // Stable handlers so memoized toolbar/list children skip re-renders when
  // unrelated state changes (notably opening/closing the New ticket dialog).
  const handleSearchChange = useCallback(
    (val: string) => {
      setSearch(val);
      if (val) {
        setStatusFilter("all");
        setResolvedClosed(false);
        setPriorityFilter("all");
        if (!isAdmin) setScope("all");
      }
    },
    [isAdmin]
  );

  const handleClearFilters = useCallback(() => {
    setSearch("");
    setStatusFilter("all");
    setResolvedClosed(false);
    setPriorityFilter("all");
    setAssigneeFilter("all");
  }, []);

  const scopeLabel =
    scope === "mine"
      ? isAdmin || isSupport
        ? "Tickets assigned to you or submitted by you"
        : "Tickets you submitted"
      : "Organization-wide support queue";

  const typeLabels = useMemo(
    () => Object.fromEntries(Object.values(TicketType).map((t) => [t, TICKET_TYPE_LABEL[t]])),
    []
  );

  return (
    <AppLayout>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="app-page-eyebrow">IT Service Desk</p>
            <h1 className="app-page-title mt-1">
              Support <span className="text-primary">tickets</span>
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {scopeLabel}
              {!isLoading && (
                <span className="font-medium text-foreground">
                  {" "}
                  · {headerTicketCount} ticket{headerTicketCount === 1 ? "" : "s"}
                </span>
              )}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-2xl border border-border/50 bg-card/70 p-1 shadow-sm backdrop-blur-sm">
              <button
                type="button"
                onClick={() => {
                  setScope("mine");
                  if (isAdmin || isSupport) setAssigneeFilter("all");
                }}
                className={`rounded-xl px-4 py-2 text-xs font-semibold transition-all ${scope === "mine" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                My tickets
              </button>
              <button
                type="button"
                onClick={() => setScope("all")}
                className={`rounded-xl px-4 py-2 text-xs font-semibold transition-all ${scope === "all" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                All tickets
              </button>
            </div>
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogTrigger asChild>
                  <Button className="h-9 rounded-xl shadow-sm">
                    <Plus className="w-4 h-4 mr-1.5" /> New ticket
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[550px] p-0 border-0 shadow-2xl rounded-2xl overflow-hidden">
                  <div className="relative px-6 py-6 border-b border-border overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.08] via-transparent to-accent/[0.06]" />
                    <DialogHeader className="relative">
                      <div className="flex items-center gap-3 mb-1">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15">
                          <FilePlus className="h-5 w-5" />
                        </div>
                        <DialogTitle className="text-2xl font-display">Create support ticket</DialogTitle>
                      </div>
                      <DialogDescription className="pl-[52px]">
                        Describe your issue or request and our team will respond promptly.
                      </DialogDescription>
                    </DialogHeader>
                  </div>
                  <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col">
                      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
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
                              <FormLabel>Related asset (optional)</FormLabel>
                              <Popover open={assetComboOpen} onOpenChange={setAssetComboOpen}>
                                <PopoverTrigger asChild>
                                  <FormControl>
                                    <Button
                                      variant="outline"
                                      role="combobox"
                                      className={cn("w-full rounded-xl justify-between font-normal h-10", !field.value && "text-muted-foreground")}
                                    >
                                      {field.value
                                        ? (() => { const a = assets?.data?.find((asset: { id: string; name: string; assetTag: string }) => asset.id === field.value); return a ? `${a.name} (${a.assetTag})` : "Select asset..."; })()
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
                                        {assets?.data?.map((a: { id: string; name: string; assetTag: string; category: string }) => (
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
                          <FormItem><FormLabel>Description</FormLabel><FormControl><Textarea placeholder="Detailed explanation..." {...field} rows={4} className="rounded-xl min-h-[96px]" /></FormControl><FormMessage /></FormItem>
                        )} />
                      </div>
                      <div className="flex shrink-0 justify-end gap-3 border-t border-border/50 px-6 py-4">
                          <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)} className="rounded-xl">Cancel</Button>
                          {createSuccess ? (
                            <Button disabled className="rounded-xl bg-emerald-600 text-white gap-2">
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                              Ticket submitted
                            </Button>
                          ) : (
                            <Button type="submit" disabled={createMutation.isPending} className="rounded-xl">
                              {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Submit ticket
                            </Button>
                          )}
                        </div>
                    </form>
                  </Form>
                </DialogContent>
              </Dialog>
          </div>
        </div>

        {/* Split layout: queue sidebar + ticket list */}
        <div className="grid gap-5 lg:grid-cols-[minmax(240px,280px)_1fr] lg:items-start">
          <TicketSummaryStrip
            {...summary}
            activeFilter={activeStatusFilter}
            onFilter={handleStripFilter}
          />

          <div className="min-w-0 space-y-4">
            <TicketToolbar
              search={search}
              onSearchChange={handleSearchChange}
              priorityFilter={priorityFilter}
              onPriorityChange={setPriorityFilter}
              assigneeFilter={assigneeFilter}
              onAssigneeChange={setAssigneeFilter}
              assignableStaff={assignableStaff}
              isAdmin={isAdmin}
              hasActiveFilters={Boolean(hasActiveFilters)}
              onClearFilters={handleClearFilters}
            />

            {isLoading ? (
              <div className="space-y-2 rounded-3xl border border-border/60 bg-card/60 p-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-[72px] rounded-xl bg-muted/40 animate-pulse" />
                ))}
              </div>
            ) : !showPersonalTicketGroups && !listTickets.length ? (
              <div className="flex flex-col items-center justify-center rounded-3xl border border-border/50 bg-card/75 p-16 text-center shadow-sm">
                <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/[0.08] ring-1 ring-primary/15">
                  <TicketIcon className="h-8 w-8 text-primary/60" />
                </div>
                <h3 className="mb-1.5 font-display text-lg font-semibold text-foreground">
                  {hasActiveFilters ? "No matching tickets" : "No tickets yet"}
                </h3>
                <p className="mb-6 max-w-sm text-sm leading-relaxed text-muted-foreground">
                  {hasActiveFilters
                    ? "Try adjusting your search or clearing the filters to see more results."
                    : isAdmin || isSupport
                      ? "No support tickets have been submitted yet. New requests will appear here."
                      : "You haven't submitted any support tickets yet. Create one to get help from the IT team."}
                </p>
                {!hasActiveFilters && (
                  <Button className="gap-2 rounded-xl" onClick={() => setIsDialogOpen(true)}>
                    <FilePlus className="h-4 w-4" /> Create ticket
                  </Button>
                )}
                {hasActiveFilters && (
                  <Button
                    variant="outline"
                    className="gap-2 rounded-xl"
                    onClick={() => {
                      setSearch("");
                      setStatusFilter("all");
                      setResolvedClosed(false);
                      setPriorityFilter("all");
                      setAssigneeFilter("all");
                    }}
                  >
                    <X className="h-4 w-4" /> Clear all filters
                  </Button>
                )}
              </div>
            ) : showPersonalTicketGroups ? (
              <div className="space-y-5">
                <PagedTicketGroup
                  userId={user!.id}
                  mode="assigned"
                  filters={queryFilters}
                  typeLabels={typeLabels}
                />
                <PagedTicketGroup
                  userId={user!.id}
                  mode="submitted"
                  filters={queryFilters}
                  typeLabels={typeLabels}
                />
              </div>
            ) : (
              <>
                <TicketInventoryList
                  tickets={listTickets as any}
                  total={listTotal}
                  typeLabels={typeLabels}
                />
                <div className="overflow-hidden rounded-2xl border border-border/50 bg-card/70 shadow-sm">
                  <PaginationBar page={page} pageSize={PAGE_SIZE} total={listTotal} onPage={setPage} />
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

