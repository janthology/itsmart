import { useState, useEffect, useMemo } from "react";
import { Link, useSearch } from "wouter";
import { useGetAssets, useCreateAsset, useAddAssetHistory, AssetCategory, AssetStatus, generateNextAssetTag } from "@/lib/supabase-queries";
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
import { Search, Plus, Loader2, MonitorSmartphone, X, PackagePlus } from "lucide-react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { SkeletonTable } from "@/components/ui/skeleton-table";

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
  }, [searchString]);

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

  // Reset to page 1 when filters change
  useEffect(() => { setPage(1); }, [search, statusFilter, categoryFilter, scope]);

  const allAssets = data?.data ?? [];
  const pagedAssets = allAssets.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
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

  return (
    <AppLayout>
      <div className="space-y-4">
        {/* Scope toggle for non-admins */}
        {/* Scope toggle — all roles including admin */}
        <div className="flex justify-end">
          <div className="flex rounded-xl border border-border/50 overflow-hidden h-9">
            <button
              onClick={() => { setScope("mine"); setAssignedToFilter(undefined); }}
              className={`px-4 text-sm font-medium transition-colors ${scope === "mine" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted"}`}
            >
              Assigned to Me
            </button>
            <button
              onClick={() => { setScope("all"); setAssignedToFilter(undefined); }}
              className={`px-4 text-sm font-medium transition-colors ${scope === "all" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted"}`}
            >
              All Assets
            </button>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2 w-full max-w-xl">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
              <Input
                placeholder="Search by name, tag, or category..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  if (e.target.value && !isAdmin) setScope("all");
                }}
                className="pl-10 h-11 rounded-xl bg-card border-border/50 shadow-sm"
              />
            </div>

            {isAdmin && (
              <Dialog open={isDialogOpen} onOpenChange={async (open) => {
                setIsDialogOpen(open);
                if (open) {
                  const tag = await generateNextAssetTag();
                  form.setValue('assetTag', tag);
                }
              }}>
                <DialogTrigger asChild>
                  <Button className="h-11 rounded-xl bg-primary hover:bg-primary/90 shadow-md shadow-primary/20 shrink-0">
                    <Plus className="w-5 h-5 mr-2" /> New Asset
                  </Button>
                </DialogTrigger>
              <DialogContent className="sm:max-w-[600px] p-0 overflow-hidden border-0 shadow-2xl rounded-2xl">
                <div className="px-6 py-6 bg-muted/30 border-b border-border">
                  <DialogHeader>
                    <DialogTitle className="text-2xl font-display">Add New Asset</DialogTitle>
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
                          <FormItem><FormLabel>Purchase Date</FormLabel><FormControl><Input type="date" {...field} value={field.value ?? ''} className="rounded-xl" /></FormControl><FormMessage /></FormItem>
                        )} />
                        <FormField control={form.control} name="purchaseValue" render={({ field }) => (
                          <FormItem><FormLabel>Purchase Value (₱)</FormLabel><FormControl><Input type="number" placeholder="0.00" {...field} value={field.value ?? ''} className="rounded-xl" /></FormControl><FormMessage /></FormItem>
                        )} />
                        <FormField control={form.control} name="lastPmDate" render={({ field }) => (
                          <FormItem><FormLabel>Last PM Date</FormLabel><FormControl><Input type="date" {...field} value={field.value ?? ''} className="rounded-xl" /></FormControl><FormMessage /></FormItem>
                        )} />
                        <FormField control={form.control} name="nextPmDate" render={({ field }) => (
                          <FormItem><FormLabel>Next PM Date</FormLabel><FormControl><Input type="date" {...field} value={field.value ?? ''} className="rounded-xl" /></FormControl><FormMessage /></FormItem>
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
                            Asset Saved!
                          </Button>
                        ) : (
                          <Button type="submit" disabled={createMutation.isPending} className="rounded-xl shadow-md shadow-primary/20">
                            {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save Asset
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

          {/* Status + Category filters */}
          <div className="flex items-center gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-11 w-[150px] rounded-xl text-sm border-border/50">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {Object.values(AssetStatus).map(s => (
                  <SelectItem key={s} value={s} className="capitalize">{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="h-11 w-[150px] rounded-xl text-sm border-border/50">
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {Object.values(AssetCategory).map(c => (
                  <SelectItem key={c} value={c} className="capitalize">{c.charAt(0).toUpperCase() + c.slice(1)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {(search || statusFilter !== "all" || categoryFilter !== "all") && (
              <Button
                variant="ghost" size="sm"
                className="h-11 px-3 rounded-xl text-muted-foreground"
                onClick={() => { setSearch(""); setStatusFilter("all"); setCategoryFilter("all"); }}
              >
                <X className="w-4 h-4 mr-1" /> Clear
              </Button>
            )}
          </div>
        </div>

        <div className="bg-card rounded-2xl shadow-lg shadow-black/5 border border-border/50 overflow-hidden">
          {isLoading ? (
            <SkeletonTable rows={6} cols={7} />
          ) : !allAssets.length ? (
            <div className="p-16 flex flex-col items-center justify-center text-center">
              <div className="w-20 h-20 rounded-2xl bg-muted flex items-center justify-center mb-4">
                <MonitorSmartphone className="w-10 h-10 text-muted-foreground/50" />
              </div>
              <h3 className="text-xl font-bold text-foreground mb-2">
                {search || statusFilter !== "all" || categoryFilter !== "all" ? "No assets match your filters" : "No assets yet"}
              </h3>
              <p className="text-muted-foreground text-sm mb-6 max-w-xs">
                {search || statusFilter !== "all" || categoryFilter !== "all"
                  ? "Try adjusting your search or clearing the filters."
                  : isAdmin
                  ? "Start building your inventory by adding your first asset."
                  : "No assets have been assigned to you yet."}
              </p>
              {isAdmin && !(search || statusFilter !== "all" || categoryFilter !== "all") && (
                <Button className="rounded-xl gap-2" onClick={async () => { setIsDialogOpen(true); const tag = await generateNextAssetTag(); form.setValue('assetTag', tag); }}>
                  <PackagePlus className="w-4 h-4" /> Add First Asset
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/30">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="font-semibold text-foreground/80 py-4 px-6">Tag</TableHead>
                    <TableHead className="font-semibold text-foreground/80">Asset Details</TableHead>
                    <TableHead className="font-semibold text-foreground/80">Serial No.</TableHead>
                    <TableHead className="font-semibold text-foreground/80">Location</TableHead>
                    <TableHead className="font-semibold text-foreground/80">Status</TableHead>
                    <TableHead className="font-semibold text-foreground/80">Assigned To</TableHead>
                    <TableHead className="font-semibold text-foreground/80 text-right px-6">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagedAssets.map((asset) => (
                    <TableRow key={asset.id} className="hover:bg-muted/30 transition-colors group">
                      <TableCell className="font-mono text-sm px-6">
                        <span className="bg-muted px-2 py-1 rounded-md border border-border/50">{asset.assetTag}</span>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-semibold text-foreground">{asset.name}</span>
                          <span className="text-xs text-muted-foreground capitalize">
                            {asset.category}{(asset as any).model ? ` · ${(asset as any).model}` : ''}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground font-mono">
                        {(asset as any).serialNumber ?? <span className="italic">—</span>}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {(asset as any).location ?? <span className="italic">—</span>}
                      </TableCell>
                      <TableCell><StatusBadge status={asset.status} /></TableCell>
                      <TableCell>
                        {asset.assignedTo ? (
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">
                              {asset.assignedTo.fullName?.charAt(0) ?? '?'}
                            </div>
                            <span className="text-sm font-medium">{asset.assignedTo.fullName}</span>
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground italic">Unassigned</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right px-6">
                        <Link href={`/assets/${asset.id}`}>
                          <Button variant="outline" size="sm" className="rounded-lg">
                            View Details
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <PaginationBar page={page} pageSize={PAGE_SIZE} total={allAssets.length} onPage={setPage} />
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}


