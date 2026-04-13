import { useState } from "react";
import { useRoute, Link, useLocation } from "wouter";
import { useGetAsset, useUpdateAsset, useGetUsers, useGetAssetHistory, useAddAssetHistory, AssetCategory, AssetStatus } from "@/lib/supabase-queries";
import { useAuth } from "@/lib/auth-context";
import { AppLayout } from "@/components/layout/app-layout";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, ArrowLeft, ArchiveX, Edit2, MonitorSmartphone, Calendar, User, Save, MapPin, Hash, UserMinus, History } from "lucide-react";
import { format } from "date-fns";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { AssetQRLabel } from "@/components/ui/asset-qr-label";

type UpdateAssetForm = {
  name: string;
  model?: string | null;
  serialNumber?: string | null;
  location?: string | null;
  category: AssetCategory;
  status: AssetStatus;
  purchaseDate?: string | null;
  purchaseValue?: number | null;
  notes?: string | null;
};

const updateAssetSchema: z.ZodType<UpdateAssetForm> = z.object({
  name: z.string().min(1, "Name is required"),
  model: z.string().optional().nullable(),
  serialNumber: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  category: z.enum(['laptop','desktop','monitor','phone','tablet','printer','server','networking','peripheral','other'] as const),
  status: z.enum(['active','inactive','maintenance','retired'] as const),
  purchaseDate: z.string().optional().nullable(),
  purchaseValue: z.coerce.number().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export default function AssetDetail() {
  const [, params] = useRoute("/assets/:id");
  const id = params?.id || "";
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const isAdmin = user?.role === 'administrator';
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [assignUserId, setAssignUserId] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"details" | "history">("details");

  const { data: asset, isLoading, isError } = useGetAsset(id);
  const updateMutation = useUpdateAsset();
  const { data: allUsers } = useGetUsers();
  const { data: history = [], isLoading: historyLoading } = useGetAssetHistory(id);
  const addHistory = useAddAssetHistory();

  const a = asset as any;

  const form = useForm<UpdateAssetForm>({
    resolver: zodResolver(updateAssetSchema),
    values: asset ? {
      name: asset.name,
      model: a.model ?? "",
      serialNumber: a.serialNumber ?? "",
      location: a.location ?? "",
      category: asset.category as AssetCategory,
      status: asset.status as AssetStatus,
      purchaseDate: asset.purchaseDate ?? "",
      purchaseValue: a.purchaseValue ?? null,
      notes: asset.notes ?? "",
    } : undefined,
  });

  const onSubmit = async (values: UpdateAssetForm) => {
    try {
      // Collect changed fields for history
      const changes: { fieldName: string; oldValue: string; newValue: string }[] = [];
      if (asset) {
        const fieldMap: [keyof UpdateAssetForm, string, string][] = [
          ['name', 'Name', asset.name],
          ['model', 'Model', a.model ?? ''],
          ['serialNumber', 'Serial Number', a.serialNumber ?? ''],
          ['location', 'Location', a.location ?? ''],
          ['category', 'Category', asset.category],
          ['status', 'Status', asset.status],
          ['purchaseDate', 'Purchase Date', asset.purchaseDate ?? ''],
          ['purchaseValue', 'Purchase Value', a.purchaseValue != null ? String(a.purchaseValue) : ''],
          ['notes', 'Notes', asset.notes ?? ''],
        ];
        for (const [key, label, oldVal] of fieldMap) {
          const newVal = String(values[key] ?? '');
          if (newVal !== String(oldVal)) changes.push({ fieldName: label, oldValue: oldVal, newValue: newVal });
        }
      }
      await updateMutation.mutateAsync({ id, data: values as any });
      for (const c of changes) {
        await addHistory.mutateAsync({ assetId: id, action: 'field_updated', ...c });
      }
      toast({ title: "Success", description: "Asset updated successfully." });
      setIsEditing(false);
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      queryClient.invalidateQueries({ queryKey: ['asset', id] });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error", description: error.message || "Failed to update asset." });
    }
  };

  const handleAssign = async () => {
    if (!assignUserId) return;
    const assigneeName = allUsers?.find(u => u.id === assignUserId)?.fullName ?? assignUserId;
    const prevAssignee = asset?.assignedTo?.fullName ?? 'Unassigned';
    try {
      await updateMutation.mutateAsync({ id, data: { assignedToId: assignUserId, status: 'active' } as any });
      await addHistory.mutateAsync({ assetId: id, action: 'assigned', fieldName: 'Assigned To', oldValue: prevAssignee, newValue: assigneeName });
      toast({ title: "Assigned", description: "Asset assigned successfully." });
      setAssignUserId("");
      queryClient.invalidateQueries({ queryKey: ['asset', id] });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error", description: error.message || "Failed to assign asset." });
    }
  };

  const handleUnassign = async () => {
    const prevAssignee = asset?.assignedTo?.fullName ?? 'Unknown';
    try {
      await updateMutation.mutateAsync({ id, data: { assignedToId: null, status: 'inactive' } as any });
      await addHistory.mutateAsync({ assetId: id, action: 'unassigned', fieldName: 'Assigned To', oldValue: prevAssignee, newValue: 'Unassigned' });
      toast({ title: "Unassigned", description: "Asset unassigned." });
      queryClient.invalidateQueries({ queryKey: ['asset', id] });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error", description: error.message || "Failed to unassign asset." });
    }
  };

  const handleRetire = async () => {
    const prevStatus = asset?.status ?? '';
    const prevAssignee = asset?.assignedTo?.fullName ?? null;
    try {
      await updateMutation.mutateAsync({ id, data: { status: 'retired', assignedToId: null } as any });
      await addHistory.mutateAsync({ assetId: id, action: 'retired', fieldName: 'Status', oldValue: prevStatus, newValue: 'retired' });
      if (prevAssignee) {
        await addHistory.mutateAsync({ assetId: id, action: 'unassigned', fieldName: 'Assigned To', oldValue: prevAssignee, newValue: 'Unassigned' });
      }
      toast({ title: "Asset retired", description: `${asset?.assetTag} has been marked as retired and unassigned.` });
      queryClient.invalidateQueries({ queryKey: ['asset', id] });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error", description: error.message || "Failed to retire asset." });
    }
  };

  if (isLoading) return <AppLayout><div className="flex h-64 items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div></AppLayout>;
  if (isError || !asset) return <AppLayout><div className="text-center p-8 text-destructive">Asset not found.</div></AppLayout>;

  return (
    <AppLayout>
      <div className="space-y-6 max-w-5xl mx-auto">
        <div className="flex items-center justify-between">
          <Link href="/assets" className="flex items-center text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-4 h-4 mr-2" /> Back to Assets
          </Link>
          {isAdmin && !isEditing && (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setIsEditing(true)} className="rounded-xl shadow-sm">
                <Edit2 className="w-4 h-4 mr-2" /> Edit Asset
              </Button>
              {asset.status !== 'retired' && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" className="rounded-xl shadow-sm border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-900/20">
                      <ArchiveX className="w-4 h-4 mr-2" /> Retire Asset
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent className="rounded-2xl">
                    <AlertDialogHeader>
                      <AlertDialogTitle>Retire this asset?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Asset <span className="font-mono font-semibold text-foreground">{asset.assetTag}</span> will be marked as <span className="font-semibold">Retired</span> and unassigned. The record is preserved for audit purposes. This action can be undone by editing the asset status.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel className="rounded-xl">Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleRetire}
                        className="bg-amber-600 hover:bg-amber-700 text-white rounded-xl"
                        disabled={updateMutation.isPending}
                      >
                        {updateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Retire Asset"}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Main card */}
          <Card className="md:col-span-2 border-border/50 shadow-lg shadow-black/5 rounded-2xl overflow-hidden">
            <div className="h-24 bg-gradient-to-r from-primary/10 to-accent/10 flex items-center p-6 border-b border-border/50 gap-4">
              <div className="w-16 h-16 bg-card rounded-2xl border-4 border-card shadow-xl flex items-center justify-center text-primary shrink-0">
                <MonitorSmartphone className="w-8 h-8" />
              </div>
              <div>
                <div className="flex items-center gap-3 mb-0.5">
                  <h2 className="text-xl font-display font-bold text-foreground">{asset.name}</h2>
                  <StatusBadge status={asset.status} />
                </div>
                <p className="text-muted-foreground font-mono text-sm">{asset.assetTag}</p>
              </div>
            </div>

            {/* Tabs — flush against the banner */}
            <div className="flex border-b border-border/50 px-8 bg-card">
              <button
                onClick={() => setActiveTab("details")}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors -mb-px ${activeTab === "details" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
              >
                <MonitorSmartphone className="w-4 h-4" /> Details
              </button>
              <button
                onClick={() => setActiveTab("history")}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors -mb-px ${activeTab === "history" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
              >
                <History className="w-4 h-4" /> History {history.length > 0 && <span className="ml-1 bg-primary/10 text-primary text-xs px-1.5 py-0.5 rounded-full">{history.length}</span>}
              </button>
            </div>

            <CardContent className="px-8 pb-8 pt-6">
              {activeTab === "details" ? (
                isEditing ? (
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
                    <div className="grid grid-cols-2 gap-4">
                      <FormField control={form.control} name="name" render={({ field }) => (
                        <FormItem><FormLabel>Asset Name</FormLabel><FormControl><Input {...field} className="rounded-xl" /></FormControl><FormMessage /></FormItem>
                      )} />
                      <FormField control={form.control} name="model" render={({ field }) => (
                        <FormItem><FormLabel>Model</FormLabel><FormControl><Input {...field} value={field.value ?? ''} className="rounded-xl" /></FormControl><FormMessage /></FormItem>
                      )} />
                      <FormField control={form.control} name="serialNumber" render={({ field }) => (
                        <FormItem><FormLabel>Serial Number</FormLabel><FormControl><Input {...field} value={field.value ?? ''} className="rounded-xl" /></FormControl><FormMessage /></FormItem>
                      )} />
                      <FormField control={form.control} name="location" render={({ field }) => (
                        <FormItem><FormLabel>Location</FormLabel><FormControl><Input {...field} value={field.value ?? ''} className="rounded-xl" /></FormControl><FormMessage /></FormItem>
                      )} />
                      <FormField control={form.control} name="category" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Category</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl><SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger></FormControl>
                            <SelectContent>{Object.values(AssetCategory).map(c => <SelectItem key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</SelectItem>)}</SelectContent>
                          </Select>
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="status" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Status</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl><SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger></FormControl>
                            <SelectContent>{Object.values(AssetStatus).map(s => <SelectItem key={s} value={s}>{s.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}</SelectItem>)}</SelectContent>
                          </Select>
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="purchaseDate" render={({ field }) => (
                        <FormItem><FormLabel>Purchase Date</FormLabel><FormControl><Input type="date" {...field} value={field.value ?? ''} className="rounded-xl" /></FormControl><FormMessage /></FormItem>
                      )} />
                      <FormField control={form.control} name="purchaseValue" render={({ field }) => (
                        <FormItem><FormLabel>Purchase Value (₱)</FormLabel><FormControl><Input type="number" placeholder="0.00" {...field} value={field.value ?? ''} className="rounded-xl" /></FormControl><FormMessage /></FormItem>
                      )} />
                    </div>
                    <FormField control={form.control} name="notes" render={({ field }) => (
                      <FormItem><FormLabel>Notes</FormLabel><FormControl><Textarea {...field} value={field.value ?? ''} className="rounded-xl min-h-[100px]" /></FormControl><FormMessage /></FormItem>
                    )} />
                    <div className="flex justify-end gap-3 pt-4 border-t border-border/50">
                      <Button type="button" variant="outline" onClick={() => setIsEditing(false)} className="rounded-xl">Cancel</Button>
                      <Button type="submit" disabled={updateMutation.isPending} className="rounded-xl shadow-md shadow-primary/20">
                        {updateMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />} Save Changes
                      </Button>
                    </div>
                  </form>
                </Form>
              ) : (
                <div className="grid grid-cols-2 gap-y-6 gap-x-8 text-sm">
                  <div><p className="text-muted-foreground mb-1">Category</p><p className="font-medium text-base">{asset.category.charAt(0).toUpperCase() + asset.category.slice(1)}</p></div>
                  <div><p className="text-muted-foreground mb-1">Model</p><p className="font-medium text-base">{a.model || <span className="text-muted-foreground italic font-normal">—</span>}</p></div>
                  <div><p className="text-muted-foreground mb-1 flex items-center gap-1"><Hash className="w-3 h-3" />Serial Number</p><p className="font-medium font-mono text-base">{a.serialNumber || <span className="text-muted-foreground italic font-normal">—</span>}</p></div>
                  <div><p className="text-muted-foreground mb-1 flex items-center gap-1"><MapPin className="w-3 h-3" />Location</p><p className="font-medium text-base">{a.location || <span className="text-muted-foreground italic font-normal">—</span>}</p></div>
                  <div><p className="text-muted-foreground mb-1">Purchase Date</p><p className="font-medium text-base">{asset.purchaseDate ? format(new Date(asset.purchaseDate), 'MMMM d, yyyy') : <span className="text-muted-foreground italic font-normal">—</span>}</p></div>
                  <div><p className="text-muted-foreground mb-1">Purchase Value</p><p className="font-medium text-base">{a.purchaseValue != null ? `₱${Number(a.purchaseValue).toLocaleString()}` : <span className="text-muted-foreground italic font-normal">—</span>}</p></div>
                  <div className="col-span-2">
                    <p className="text-muted-foreground mb-2">Notes</p>
                    <p className="font-medium bg-muted/30 p-4 rounded-xl border border-border/50 min-h-[80px]">
                      {asset.notes || <span className="text-muted-foreground italic font-normal">No additional notes provided.</span>}
                    </p>
                  </div>
                </div>
              )
              ) : (
                /* History Tab */
                <div className="space-y-1">
                  {historyLoading ? (
                    <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
                  ) : history.length === 0 ? (
                    <div className="text-center py-10 text-muted-foreground">
                      <History className="w-10 h-10 mx-auto mb-3 text-muted" />
                      <p>No history recorded yet.</p>
                    </div>
                  ) : (
                    <div className="relative pl-6 border-l-2 border-border/50 space-y-5">
                      {history.map((entry) => {
                        const actionLabel: Record<string, string> = {
                          assigned:      '👤 Assigned',
                          unassigned:    '🔓 Unassigned',
                          field_updated: '✏️ Updated',
                          created:       '✅ Created',
                          retired:       '📦 Retired',
                        };
                        // Capitalize raw enum values for display
                        const formatValue = (v: string | null) =>
                          v ? v.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) : null;
                        return (
                          <div key={entry.id} className="relative">
                            <div className="absolute -left-[1.65rem] top-1 w-3 h-3 rounded-full bg-primary/30 border-2 border-primary" />
                            <div className="bg-muted/30 rounded-xl border border-border/50 p-4 space-y-1.5">
                              <div className="flex items-center justify-between gap-2 flex-wrap">
                                <span className="font-semibold text-sm text-foreground">
                                  {actionLabel[entry.action.toLowerCase()] ?? entry.action.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                                  {entry.fieldName && <span className="text-muted-foreground font-normal"> — {entry.fieldName}</span>}
                                </span>
                                <span className="text-xs text-muted-foreground">{format(new Date(entry.createdAt), 'MMM d, yyyy h:mm a')}</span>
                              </div>
                              {(entry.oldValue || entry.newValue) && (
                                <div className="flex items-center gap-2 text-xs flex-wrap">
                                  {entry.oldValue && <span className="bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 px-2 py-0.5 rounded-md border border-red-200 dark:border-red-800 line-through">{formatValue(entry.oldValue) || '—'}</span>}
                                  {entry.oldValue && entry.newValue && <span className="text-muted-foreground">→</span>}
                                  {entry.newValue && <span className="bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 px-2 py-0.5 rounded-md border border-green-200 dark:border-green-800">{formatValue(entry.newValue) || '—'}</span>}
                                </div>
                              )}
                              {entry.changedBy && (
                                <p className="text-xs text-muted-foreground">by {entry.changedBy.fullName}</p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Sidebar */}
          <div className="space-y-6">
            <Card className="border-border/50 shadow-lg shadow-black/5 rounded-2xl">
              <CardHeader className="border-b border-border/50 py-4 px-6">
                <CardTitle className="text-base font-display flex items-center gap-2"><User className="w-5 h-5 text-primary" /> Assignment</CardTitle>
              </CardHeader>
              <CardContent className="p-6 space-y-4">
                {asset.assignedTo ? (
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold text-xl">
                      {asset.assignedTo.fullName.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-foreground truncate">{asset.assignedTo.fullName}</p>
                      <p className="text-sm text-muted-foreground">{asset.assignedTo.department || 'No department'}</p>
                    </div>
                  </div>
                ) : (
                  <div className="text-center p-4 text-muted-foreground bg-muted/30 rounded-xl border border-dashed border-border">
                    <p className="italic">Currently Unassigned</p>
                  </div>
                )}
                {isAdmin && (
                  <div className="space-y-2 pt-2 border-t border-border/50">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Reassign to</p>
                    <Select value={assignUserId} onValueChange={setAssignUserId}>
                      <SelectTrigger className="rounded-xl text-sm">
                        <SelectValue placeholder="Select a user..." />
                      </SelectTrigger>
                      <SelectContent>
                        {(allUsers ?? [])
                          .filter(u => u.id !== asset.assignedTo?.id)
                          .map(u => (
                            <SelectItem key={u.id} value={u.id}>{u.fullName}</SelectItem>
                          ))
                        }
                      </SelectContent>
                    </Select>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="flex-1 rounded-xl"
                        disabled={!assignUserId || updateMutation.isPending}
                        onClick={handleAssign}
                      >
                        {updateMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Assign"}
                      </Button>
                      {asset.assignedTo && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="rounded-xl"
                          disabled={updateMutation.isPending}
                          onClick={handleUnassign}
                        >
                          <UserMinus className="w-3 h-3 mr-1" /> Unassign
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-border/50 shadow-lg shadow-black/5 rounded-2xl">
              <CardHeader className="border-b border-border/50 py-4 px-6">
                <CardTitle className="text-base font-display flex items-center gap-2"><Calendar className="w-5 h-5 text-primary" /> Timeline</CardTitle>
              </CardHeader>
              <CardContent className="p-6 space-y-4 text-sm">
                <div className="flex justify-between items-center pb-4 border-b border-border/50">
                  <span className="text-muted-foreground">Created</span>
                  <span className="font-medium">{format(new Date(asset.createdAt), 'MMM d, yyyy')}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Last Updated</span>
                  <span className="font-medium">{format(new Date(asset.updatedAt), 'MMM d, yyyy')}</span>
                </div>
              </CardContent>
            </Card>

            <AssetQRLabel
              assetTag={asset.assetTag}
              assetName={asset.name}
              category={asset.category}
              location={a.location}
              serialNumber={a.serialNumber}
            />
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
