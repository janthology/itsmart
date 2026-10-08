import { useState, useEffect, useMemo } from "react";
import { useSearch } from "wouter";
import { useGetAssets, useCreateAsset, useAddAssetHistory, AssetCategory, AssetStatus, generateNextAssetTag } from "@/lib/supabase-queries";
import { useAuth } from "@/lib/auth-context";
import { AppLayout } from "@/components/layout/app-layout";
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
  assetTag: z.string().min(1, "Tag is required"),
  name: z.string().min(1, "Name is required"),
  model: z.string().optional().nullable(),
  serialNumber: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  category: z.nativeEnum(AssetCategory),
  status: z.nativeEnum(AssetStatus),
  purchaseDate: z.string().optional().nullable(),
  purchaseValue: z.coerce.number().optional().nullable(),
  lastPmDate: z.string().optional().nullable(),
  nextPmDate: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

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

  const form = useForm<z.infer<typeof createAssetSchema>>({
    resolver: zodResolver(createAssetSchema),
    defaultValues: {
      assetTag: "", name: "", model: "", serialNumber: "", location: "",
      category: "laptop" as AssetCategory, status: "active" as AssetStatus,
      purchaseDate: "", purchaseValue: null, lastPmDate: "", nextPmDate: "", notes: "",
    },
  });

  // Keyboard shortcut: N = new asset (admin only), / = focus search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if ((e.key === 'n' || e.key === 'N') && isAdmin) { e.preventDefault(); setIsDialogOpen(true); generateNextAssetTag().then(tag => form.setValue('assetTag', tag)); }
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

  const { data, isLoading } = useGetAssets({ query: queryFilters });
  const createMutation = useCreateAsset();
  const addHistory = useAddAssetHistory();

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
    try {
      const newAsset = await createMutation.mutateAsync({ data: values as any });
      // Log creation event
      if (newAsset?.id) {
        await addHistory.mutateAsync({
          assetId: newAsset.id,
          action: 'created',
          fieldName: 'Asset',
          oldValue: undefined,
          newValue: `${values.assetTag} — ${values.name}`,
        });
      }
      setCreateSuccess(true);
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      setTimeout(() => {
        setIsDialogOpen(false);
        setCreateSuccess(false);
        form.reset();
      }, 1200);
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error", description: error.message || "Failed to create asset." });
    }
  };

  const categories = Object.values(AssetCategory);
  const hasActiveFilters = Boolean(search || statusFilter !== "all" || categoryFilter !== "all");

  return (
    <AppLayout>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="app-page-eyebrow">IT Asset Management</p>
            <h1 className="app-page-title mt-1">
              Asset <span className="text-primary">fleet</span>
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {scope === "mine" ? "Equipment assigned to you" : "Organization-wide registry"}
              {!isLoading && (
                <span className="font-medium text-foreground"> · {allAssets.length} device{allAssets.length === 1 ? "" : "s"}</span>
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
                <Dialog
                  open={isDialogOpen}
                  onOpenChange={async (open) => {
                    setIsDialogOpen(open);
                    if (open) {
                      const tag = await generateNextAssetTag();
                      form.setValue("assetTag", tag);
                    }
                  }}
                >
                  <DialogTrigger asChild>
                    <Button className="h-9 rounded-xl shadow-sm">
                      <Plus className="w-4 h-4 mr-1.5" /> New asset
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-[600px] p-0 overflow-hidden border-0 shadow-2xl rounded-2xl">
                    <div className="px-6 py-6 bg-muted/30 border-b border-border">
                      <DialogHeader>
                        <DialogTitle className="text-2xl font-display">Add new asset</DialogTitle>
                        <DialogDescription>Enter the details for the new inventory item.</DialogDescription>
                      </DialogHeader>
                    </div>
                    <div className="p-6 max-h-[70vh] overflow-y-auto">
                      <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                          <div className="grid grid-cols-2 gap-4">
                            <FormField control={form.control} name="assetTag" render={({ field }) => (
                              <FormItem>
                                <FormLabel>Asset Tag</FormLabel>
                                <FormControl>
                                  <Input {...field} readOnly className="rounded-xl bg-muted/50 text-muted-foreground font-mono cursor-not-allowed" />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )} />
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
                            <FormField control={form.control} name="nextPmDate" render={({ field }) => (
                              <FormItem><FormLabel>Next PM Date</FormLabel><FormControl><DateInput {...field} value={field.value ?? ''} className="rounded-xl" /></FormControl><FormMessage /></FormItem>
                            )} />
                          </div>
                          <FormField control={form.control} name="notes" render={({ field }) => (
                            <FormItem><FormLabel>Notes</FormLabel><FormControl><Textarea placeholder="Additional notes..." {...field} value={field.value ?? ''} className="rounded-xl min-h-[80px]" /></FormControl><FormMessage /></FormItem>
                          )} />
                          <div className="pt-4 flex justify-end gap-3 border-t border-border/50">
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
                    </div>
                  </DialogContent>
                </Dialog>
              )}
          </div>
        </div>

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
              <div className="space-y-2 rounded-3xl border border-border/60 bg-card/60 p-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-16 rounded-xl bg-muted/40 animate-pulse" />
                ))}
              </div>
            ) : !allAssets.length ? (
              <div className="flex flex-col items-center justify-center rounded-3xl border border-border/50 bg-card/75 p-16 text-center shadow-sm">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/[0.06] ring-1 ring-primary/10">
                  <MonitorSmartphone className="h-8 w-8 text-primary/40" />
                </div>
                <h3 className="mb-1.5 font-display text-lg font-semibold text-foreground">
                  {hasActiveFilters ? "No matching assets" : "No assets yet"}
                </h3>
                <p className="mb-6 max-w-sm text-sm leading-relaxed text-muted-foreground">
                  {hasActiveFilters
                    ? "Try adjusting your search or clearing the filters."
                    : isAdmin
                      ? "Start building your inventory by adding your first asset."
                      : "No assets have been assigned to you yet."}
                </p>
                {isAdmin && !hasActiveFilters && (
                  <Button
                    className="gap-2 rounded-xl"
                    onClick={async () => {
                      setIsDialogOpen(true);
                      const tag = await generateNextAssetTag();
                      form.setValue("assetTag", tag);
                    }}
                  >
                    <PackagePlus className="h-4 w-4" /> Add first asset
                  </Button>
                )}
              </div>
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


