import { useState } from "react";
import { useRoute, Link, useLocation } from "wouter";
import { useGetAsset, useUpdateAsset, useDeleteAsset, AssetCategory, AssetStatus } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth-context";
import { AppLayout } from "@/components/layout/app-layout";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, ArrowLeft, Trash2, Edit2, MonitorSmartphone, Calendar, User, Save } from "lucide-react";
import { format } from "date-fns";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

const updateAssetSchema = z.object({
  name: z.string().min(1, "Name is required"),
  category: z.nativeEnum(AssetCategory),
  status: z.nativeEnum(AssetStatus),
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

  const { data: asset, isLoading, isError } = useGetAsset(id);
  const updateMutation = useUpdateAsset();
  const deleteMutation = useDeleteAsset();

  const form = useForm<z.infer<typeof updateAssetSchema>>({
    resolver: zodResolver(updateAssetSchema),
    values: asset ? {
      name: asset.name,
      category: asset.category,
      status: asset.status,
      notes: asset.notes || "",
    } : undefined
  });

  const onSubmit = async (values: z.infer<typeof updateAssetSchema>) => {
    try {
      await updateMutation.mutateAsync({ id, data: values });
      toast({ title: "Success", description: "Asset updated successfully." });
      setIsEditing(false);
      queryClient.invalidateQueries({ queryKey: [`/api/assets/${id}`] });
      queryClient.invalidateQueries({ queryKey: ['/api/assets'] });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error", description: error.message || "Failed to update asset." });
    }
  };

  const handleDelete = async () => {
    try {
      await deleteMutation.mutateAsync({ id });
      toast({ title: "Success", description: "Asset deleted." });
      queryClient.invalidateQueries({ queryKey: ['/api/assets'] });
      setLocation("/assets");
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error", description: error.message || "Failed to delete asset." });
    }
  };

  if (isLoading) return <AppLayout><div className="flex h-64 items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div></AppLayout>;
  if (isError || !asset) return <AppLayout><div className="text-center p-8 text-destructive">Asset not found.</div></AppLayout>;

  return (
    <AppLayout>
      <div className="space-y-6 max-w-4xl mx-auto">
        <div className="flex items-center justify-between">
          <Link href="/assets" className="flex items-center text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-4 h-4 mr-2" /> Back to Assets
          </Link>
          {isAdmin && !isEditing && (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setIsEditing(true)} className="rounded-xl shadow-sm">
                <Edit2 className="w-4 h-4 mr-2" /> Edit Asset
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" className="rounded-xl shadow-sm shadow-destructive/20">
                    <Trash2 className="w-4 h-4 mr-2" /> Delete
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="rounded-2xl">
                  <AlertDialogHeader>
                    <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This action cannot be undone. This will permanently delete the asset "{asset.assetTag}".
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel className="rounded-xl">Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded-xl">
                      {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Delete Asset"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="md:col-span-2 border-border/50 shadow-lg shadow-black/5 rounded-2xl overflow-hidden">
            <div className="h-32 bg-gradient-to-r from-primary/10 to-accent/10 flex items-end p-6 border-b border-border/50">
              <div className="flex items-center gap-4 translate-y-8">
                <div className="w-20 h-20 bg-card rounded-2xl border-4 border-card shadow-xl flex items-center justify-center text-primary">
                  <MonitorSmartphone className="w-10 h-10" />
                </div>
                <div className="pb-2">
                  <div className="flex items-center gap-3 mb-1">
                    <h2 className="text-2xl font-display font-bold text-foreground">{asset.name}</h2>
                    <StatusBadge status={asset.status} />
                  </div>
                  <p className="text-muted-foreground font-mono text-sm">{asset.assetTag}</p>
                </div>
              </div>
            </div>
            
            <CardContent className="pt-16 px-8 pb-8">
              {isEditing ? (
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                    <div className="grid grid-cols-2 gap-6">
                      <FormField control={form.control} name="name" render={({ field }) => (
                        <FormItem><FormLabel>Device Name</FormLabel><FormControl><Input {...field} className="rounded-xl" /></FormControl></FormItem>
                      )} />
                      <FormField control={form.control} name="category" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Category</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl><SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger></FormControl>
                            <SelectContent>
                              {Object.values(AssetCategory).map(cat => <SelectItem key={cat} value={cat} className="capitalize">{cat}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="status" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Status</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl><SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger></FormControl>
                            <SelectContent>
                              {Object.values(AssetStatus).map(s => <SelectItem key={s} value={s} className="capitalize">{s.replace('_',' ')}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )} />
                    </div>
                    <FormField control={form.control} name="notes" render={({ field }) => (
                      <FormItem><FormLabel>Notes</FormLabel><FormControl><Textarea {...field} value={field.value || ''} className="rounded-xl min-h-[100px]" /></FormControl></FormItem>
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
                <div className="space-y-8">
                  <div className="grid grid-cols-2 gap-y-6 text-sm">
                    <div><p className="text-muted-foreground mb-1">Category</p><p className="font-medium capitalize text-base">{asset.category}</p></div>
                    <div><p className="text-muted-foreground mb-1">Added On</p><p className="font-medium text-base">{format(new Date(asset.createdAt), 'MMMM d, yyyy')}</p></div>
                    <div className="col-span-2">
                      <p className="text-muted-foreground mb-2">Notes</p>
                      <p className="font-medium bg-muted/30 p-4 rounded-xl border border-border/50 min-h-[80px]">
                        {asset.notes || <span className="text-muted-foreground italic font-normal">No additional notes provided.</span>}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card className="border-border/50 shadow-lg shadow-black/5 rounded-2xl">
              <CardHeader className="border-b border-border/50 py-4 px-6"><CardTitle className="text-base font-display flex items-center gap-2"><User className="w-5 h-5 text-primary" /> Assignment</CardTitle></CardHeader>
              <CardContent className="p-6">
                {asset.assignedTo ? (
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold text-xl">
                      {asset.assignedTo.fullName.charAt(0)}
                    </div>
                    <div>
                      <p className="font-bold text-foreground">{asset.assignedTo.fullName}</p>
                      <p className="text-sm text-muted-foreground">{asset.assignedTo.department || 'No department'}</p>
                    </div>
                  </div>
                ) : (
                  <div className="text-center p-4 text-muted-foreground bg-muted/30 rounded-xl border border-dashed border-border">
                    <p className="italic">Currently Unassigned</p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-border/50 shadow-lg shadow-black/5 rounded-2xl">
              <CardHeader className="border-b border-border/50 py-4 px-6"><CardTitle className="text-base font-display flex items-center gap-2"><Calendar className="w-5 h-5 text-primary" /> Timeline</CardTitle></CardHeader>
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
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
