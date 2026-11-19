import { useState, useEffect, useMemo, useRef } from "react";
import { useSearch } from "wouter";
import { useGetAssets, useCreateAsset, assetCreationPayload, AssetCategory, AssetStatus } from "@/lib/supabase-queries";
import { clearAssetAttempt, fingerprintAssetPayload, readAssetAttempt, saveAssetAttempt } from "@/lib/asset-creation-retry";
import { useAuth } from "@/lib/auth-context";
import { AppLayout } from "@/components/layout/app-layout";
import { PageHeader } from "@/components/layout/page-header";
import { ListSkeleton, EmptyState, ErrorState } from "@/components/ui/page-states";
import { PaginationBar } from "@/components/ui/pagination-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Loader2, MonitorSmartphone, PackagePlus } from "lucide-react";
import { AssetSummaryStrip } from "@/components/assets/asset-summary-strip";
import { AssetInventoryList } from "@/components/assets/asset-inventory-list";
import { AssetToolbar } from "@/components/assets/asset-toolbar";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

const PAGE_SIZE = 25;

const createAssetSchema = z.object({
  name: z.string().min(1, "Name is required"),
  model: z.string().optional().nullable(),
  serialNumber: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  category: z.nativeEnum(AssetCategory),
  status: z.nativeEnum(AssetStatus),
  purchaseDate: z.string().optional().nullable(),
  purchaseValue: z.coerce.number<number>().optional().nullable(),
  lastPmDate: z.string().optional().nullable(),
  nextPmDate: z.string().optional().nullable(),
  pmRequired: z.boolean(),
  notes: z.string().optional().nullable(),
}).refine(v => !v.pmRequired || !!v.nextPmDate, { path: ['nextPmDate'], message: 'Set the next PM date or mark PM not required' })
  .refine(v => !v.pmRequired || !v.lastPmDate || !v.nextPmDate || v.nextPmDate > v.lastPmDate, { path: ['nextPmDate'], message: 'Next PM must be after Last PM' });

export default function AssetsList() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'administrator';
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [scope, setScope] = useState<"mine" | "all">(isAdmin ? "all" : "mine");
  const [assignedToFilter, setAssignedToFilter] = useState<string | undefined>(undefined);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [createSuccess, setCreateSuccess] = useState(false);
  const [creationWarning, setCreationWarning] = useState(false);
  const [retryStorageError, setRetryStorageError] = useState(false);
  const submittingCreation = useRef(false);

  useEffect(() => {
    if (!user?.id) { setCreationWarning(false); setRetryStorageError(false); return; }
    try {
      setCreationWarning(readAssetAttempt(window.sessionStorage, user.id) !== null);
      setRetryStorageError(false);
    } catch {
      // Fail closed: an unreadable record may represent an ambiguous request.
      setCreationWarning(true);
      setRetryStorageError(true);
    }
  }, [user?.id]);

  const form = useForm<z.infer<typeof createAssetSchema>>({
    resolver: zodResolver(createAssetSchema),
    defaultValues: {
      name: "", model: "", serialNumber: "", location: "",
      category: "laptop" as AssetCategory, status: "active" as AssetStatus,
      purchaseDate: "", purchaseValue: null, lastPmDate: "", nextPmDate: "", pmRequired: true, notes: "",
    },
  });

  // Keyboard shortcut: N = new asset (admin only), / = focus search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if ((e.key === 'n' || e.key === 'N') && isAdmin) { e.preventDefault(); setIsDialogOpen(true); }
      if (e.key === '/') { e.preventDefault(); document.querySelector<HTMLInputElement>('input[placeholder*="Search"]')?.focus(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isAdmin]);

  // Read ?status=, ?assignedTo=, ?scope= from URL on every navigation
  // Explicitly reset to defaults when params are absent so sidebar link /assets always shows all assets
  const searchString = useSearch();
  useEffect(() => {
    const params = new URLSearchParams(searchString);
    const s = params.get("status");
    const at = params.get("assignedTo");
    const sc = params.get("scope");

    setStatusFilter(s && Object.values(AssetStatus).includes(s as AssetStatus) ? s : "all");
    setAssignedToFilter(at ?? undefined);

    if (at) {
      setScope("all");
    } else if (sc === "mine") {
      setScope("mine");
    } else if (sc === "all") {
      setScope("all");
    } else {
      // No scope param — admin defaults to "all", non-admin defaults to "mine"
      setScope(isAdmin ? "all" : "mine");
    }
  }, [searchString, isAdmin]);

  const queryFilters: any = {
    search: search || undefined,
    status: statusFilter !== "all" ? statusFilter as AssetStatus : undefined,
    category: categoryFilter !== "all" ? categoryFilter as AssetCategory : undefined,
  };
  // assignedToFilter takes precedence (set from URL param, e.g. admin "Assets Assigned to Me" card)
  if (assignedToFilter) {
    queryFilters.assignedTo = assignedToFilter;
  } else if (scope === "mine") {
    // Works for all roles — admin, support staff, general user
    queryFilters.assignedTo = user?.id;
  }

  const { data, isLoading, error: assetsError, refetch: refetchAssets } = useGetAssets({ query: queryFilters });
  const createMutation = useCreateAsset();

  // Fleet composition uses scope only — not narrowed by status, category, or search
  const summaryQueryFilters: { assignedTo?: string } = {};
  if (assignedToFilter) {
    summaryQueryFilters.assignedTo = assignedToFilter;
  } else if (scope === "mine" && user?.id) {
    summaryQueryFilters.assignedTo = user.id;
  }
  const { data: summaryData } = useGetAssets({ query: summaryQueryFilters });

  // Reset to page 1 when filters change
  useEffect(() => { setPage(1); }, [search, statusFilter, categoryFilter, scope, assignedToFilter]);

  const allAssets = data?.data ?? [];
  const pagedAssets = allAssets.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const baseForSummary = summaryData?.data ?? [];
  const summary = useMemo(
    () => ({
      total: baseForSummary.length,
      active: baseForSummary.filter((a) => String(a.status) === AssetStatus.active).length,
      inactive: baseForSummary.filter((a) => String(a.status) === AssetStatus.inactive).length,
      maintenance: baseForSummary.filter((a) => String(a.status) === AssetStatus.maintenance).length,
      retired: baseForSummary.filter((a) => String(a.status) === AssetStatus.retired).length,
    }),
    [baseForSummary]
  );
  const onSubmit = async (values: z.infer<typeof createAssetSchema>) => {
    if (submittingCreation.current || !user?.id) return;
    submittingCreation.current = true;
    const actor = user.id;
    const data = { ...values, nextPmDate: values.pmRequired ? values.nextPmDate : null };
    try {
      let requestId: string;
      try {
        const digest = await fingerprintAssetPayload(JSON.stringify(assetCreationPayload(data)));
        const prior = readAssetAttempt(window.sessionStorage, actor);
        if (prior && prior.fingerprint !== digest) {
          toast({ variant: "destructive", title: "Check the previous request", description: "Retry the same details, or check the asset list before allowing a new request." });
          setCreationWarning(true);
          return;
        }
        const attempt = prior ?? { version: 1 as const, requestId: crypto.randomUUID(), fingerprint: digest };
        // Persist before sending. If this fails, do not issue the mutation.
        saveAssetAttempt(window.sessionStorage, actor, attempt);
        requestId = attempt.requestId;
        setRetryStorageError(false);
      } catch {
        setCreationWarning(true);
        setRetryStorageError(true);
        toast({ variant: "destructive", title: "Cannot safely save retry information", description: "No asset request was sent. Check browser storage and review any previous request." });
        return;
      }
      try {
        await createMutation.mutateAsync({ requestId, data });
        try {
          clearAssetAttempt(window.sessionStorage, actor);
          setCreationWarning(false);
          setRetryStorageError(false);
        } catch {
          setCreationWarning(true);
          setRetryStorageError(true);
        }
        setCreateSuccess(true);
        void queryClient.invalidateQueries({ queryKey: ['assets'] });
        setTimeout(() => {
          setIsDialogOpen(false);
          setCreateSuccess(false);
          form.reset();
        }, 1200);
      } catch {
        // The response may be lost after commit. Keep the ID and fingerprint
        // so an identical retry in this tab survives navigation or reload.
        setCreationWarning(true);
        void queryClient.invalidateQueries({ queryKey: ['assets'] });
      }
    } finally {
      submittingCreation.current = false;
    }
  };

  const creationWarningContent = creationWarning && (
    <div role="alert" className="rounded-xl border border-amber-500/50 bg-amber-50 p-4 text-sm text-amber-950 dark:bg-amber-950/40 dark:text-amber-100">
      <p className="font-semibold">Asset creation needs review</p>
      <p>A previous request may have succeeded. Retry the exact same details, or check the asset list before starting a new request.</p>
      <p className="mt-1">The retry key is kept only in this browser tab; closing the tab, clearing browser storage, or using another tab or device can lose it. Asset details are not saved here.</p>
      {retryStorageError && <p className="mt-1">Retry information is unavailable. No new request will be sent until browser storage is available and the previous result is reviewed.</p>}
      <Button type="button" variant="outline" size="sm" className="mt-2" disabled={createMutation.isPending} onClick={() => {
        if (!user?.id) return;
        try {
          clearAssetAttempt(window.sessionStorage, user.id);
          setCreationWarning(false);
          setRetryStorageError(false);
        } catch {
          setRetryStorageError(true);
          toast({ variant: "destructive", title: "Could not clear retry information", description: "Check browser storage before starting a new request." });
        }
      }}>I checked; allow a new request</Button>
    </div>
  );

  const categories = Object.values(AssetCategory);
  const hasActiveFilters = Boolean(search || statusFilter !== "all" || categoryFilter !== "all");

  return (
    <AppLayout>
      <div className="space-y-5">
        {/* Header */}
        <PageHeader
          eyebrow="IT Asset Management"
          title={<>Asset <span className="text-primary">fleet</span></>}
          subtitle={
            <>
              {scope === "mine" ? "Equipment assigned to you" : "Organization-wide registry"}
              {!isLoading && (
                <span className="font-medium text-foreground"> · {allAssets.length} device{allAssets.length === 1 ? "" : "s"}</span>
              )}
            </>
          }
        >
            <div className="flex rounded-2xl border border-border/50 bg-card/70 p-1 shadow-sm backdrop-blur-sm">
              <button
                type="button"
                onClick={() => {
                  setScope("mine");
                  setAssignedToFilter(undefined);
                }}
                className={`rounded-xl px-4 py-2 text-xs font-semibold transition-all ${scope === "mine" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                My assets
              </button>
              <button
                type="button"
                onClick={() => {
                  setScope("all");
                  setAssignedToFilter(undefined);
                }}
                className={`rounded-xl px-4 py-2 text-xs font-semibold transition-all ${scope === "all" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                All assets
              </button>
            </div>
            {isAdmin && (
                <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                  <DialogTrigger asChild>
                    <Button className="h-9 rounded-xl shadow-sm">
                      <Plus className="w-4 h-4 mr-1.5" /> New asset
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-[780px] p-0 gap-0 overflow-hidden border-0 shadow-2xl rounded-2xl flex max-h-[94vh] flex-col">
                    <div className="shrink-0 px-6 py-4 bg-muted/30 border-b border-border">
                      <DialogHeader>
                        <DialogTitle className="text-2xl font-display">Add new asset</DialogTitle>
                        <DialogDescription>Enter the details for the new inventory item.</DialogDescription>
                      </DialogHeader>
                    </div>
                    <Form {...form}>
                      <form onSubmit={form.handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col">
                        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
                          {creationWarningContent}
                          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                            <div className="space-y-2">
                              <p className="text-sm font-medium">Asset Tag</p>
                              <p className="rounded-xl border border-input bg-muted/50 px-3 py-2 text-sm text-muted-foreground">Assigned when saved</p>
                            </div>
                            <FormField control={form.control} name="name" render={({ field }) => (
                              <FormItem><FormLabel>Asset Name</FormLabel><FormControl><Input placeholder="e.g. Dell Laptop" {...field} className="rounded-xl" /></FormControl><FormMessage /></FormItem>
                            )} />
                            <FormField control={form.control} name="model" render={({ field }) => (
                              <FormItem><FormLabel>Model</FormLabel><FormControl><Input placeholder="e.g. Latitude 5520" {...field} value={field.value ?? ''} className="rounded-xl" /></FormControl><FormMessage /></FormItem>
                            )} />
                            <FormField control={form.control} name="serialNumber" render={({ field }) => (
                              <FormItem><FormLabel>Serial Number</FormLabel><FormControl><Input placeholder="e.g. SN-XXXXXXX" {...field} value={field.value ?? ''} className="rounded-xl" /></FormControl><FormMessage /></FormItem>
                            )} />
                            <FormField control={form.control} name="category" render={({ field }) => (
                              <FormItem>
                                <FormLabel>Category</FormLabel>
                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                  <FormControl><SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger></FormControl>
                                  <SelectContent>{Object.values(AssetCategory).map(c => <SelectItem key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</SelectItem>)}</SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )} />
                            <FormField control={form.control} name="status" render={({ field }) => (
                              <FormItem>
                                <FormLabel>Status</FormLabel>
                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                  <FormControl><SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger></FormControl>
                                  <SelectContent>{Object.values(AssetStatus).map(s => <SelectItem key={s} value={s}>{s.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}</SelectItem>)}</SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )} />
                            <FormField control={form.control} name="location" render={({ field }) => (
                              <FormItem><FormLabel>Location</FormLabel><FormControl><Input placeholder="e.g. Room 201" {...field} value={field.value ?? ''} className="rounded-xl" /></FormControl><FormMessage /></FormItem>
                            )} />
                            <FormField control={form.control} name="purchaseDate" render={({ field }) => (
                              <FormItem><FormLabel>Purchase Date</FormLabel><FormControl><DateInput {...field} value={field.value ?? ''} className="rounded-xl" /></FormControl><FormMessage /></FormItem>
                            )} />
                            <FormField control={form.control} name="purchaseValue" render={({ field }) => (
                              <FormItem><FormLabel>Purchase Value (₱)</FormLabel><FormControl><Input type="number" placeholder="0.00" {...field} value={field.value ?? ''} className="rounded-xl" /></FormControl><FormMessage /></FormItem>
                            )} />
                            <FormField control={form.control} name="lastPmDate" render={({ field }) => (
                              <FormItem><FormLabel>Last PM Date</FormLabel><FormControl><DateInput {...field} value={field.value ?? ''} className="rounded-xl" /></FormControl><FormMessage /></FormItem>
                            )} />
                            <FormField control={form.control} name="pmRequired" render={({ field }) => (
                              <FormItem className="col-span-2"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={field.value} onChange={e => field.onChange(e.target.checked)} /> Preventive maintenance required</label></FormItem>
                            )} />
                            <FormField control={form.control} name="nextPmDate" render={({ field }) => (
                              <FormItem><FormLabel>Next PM Date</FormLabel><FormControl><DateInput {...field} disabled={!form.watch("pmRequired")} value={field.value ?? ''} className="rounded-xl" /></FormControl><FormMessage /></FormItem>
                            )} />
                          </div>
                          <FormField control={form.control} name="notes" render={({ field }) => (
                            <FormItem className="mt-3"><FormLabel>Notes</FormLabel><FormControl><Textarea placeholder="Additional notes..." {...field} value={field.value ?? ''} rows={2} className="rounded-xl min-h-[56px]" /></FormControl><FormMessage /></FormItem>
                          )} />
                        </div>
                        <div className="flex shrink-0 justify-end gap-3 border-t border-border/50 px-6 py-4">
                          <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)} className="rounded-xl">Cancel</Button>
                          {createSuccess ? (
                            <Button disabled className="rounded-xl bg-emerald-600 text-white gap-2">
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                              Asset saved
                            </Button>
                          ) : (
                            <Button type="submit" disabled={createMutation.isPending} className="rounded-xl">
                              {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save asset
                            </Button>
                          )}
                        </div>
                      </form>
                    </Form>
                  </DialogContent>
                </Dialog>
              )}
        </PageHeader>
        {!isDialogOpen && creationWarningContent}

        {/* Split layout: fleet sidebar + inventory */}
        <div className="grid gap-5 lg:grid-cols-[minmax(240px,280px)_1fr] lg:items-start">
          <AssetSummaryStrip
            {...summary}
            statusFilter={statusFilter}
            onStatusFilter={setStatusFilter}
          />

          <div className="min-w-0 space-y-4">
            <AssetToolbar
              search={search}
              onSearchChange={(value) => {
                setSearch(value);
                if (value && !isAdmin) setScope("all");
              }}
              categoryFilter={categoryFilter}
              onCategoryChange={setCategoryFilter}
              categories={categories}
              hasActiveFilters={hasActiveFilters}
              onClearFilters={() => {
                setSearch("");
                setStatusFilter("all");
                setCategoryFilter("all");
              }}
            />

            {isLoading ? (
              <ListSkeleton rowHeight={64} />
            ) : assetsError && !data ? (
              <ErrorState
                title="Couldn't load assets"
                message="The asset registry couldn't be loaded. Check your connection and try again."
                onRetry={() => refetchAssets()}
              />
            ) : !allAssets.length ? (
              <EmptyState
                icon={MonitorSmartphone}
                title={hasActiveFilters ? "No matching assets" : "No assets yet"}
                message={
                  hasActiveFilters
                    ? "Try adjusting your search or clearing the filters."
                    : isAdmin
                      ? "Start building your inventory by adding your first asset."
                      : "No assets have been assigned to you yet."
                }
                action={
                  isAdmin && !hasActiveFilters ? (
                    <Button
                      className="gap-2 rounded-xl"
                      onClick={() => setIsDialogOpen(true)}
                    >
                      <PackagePlus className="h-4 w-4" /> Add first asset
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <>
                <AssetInventoryList assets={pagedAssets as any} total={allAssets.length} />
                <div className="overflow-hidden rounded-2xl border border-border/50 bg-card/70 shadow-sm">
                  <PaginationBar page={page} pageSize={PAGE_SIZE} total={allAssets.length} onPage={setPage} />
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}


