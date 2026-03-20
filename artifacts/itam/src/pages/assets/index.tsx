import { useState } from "react";
import { Link } from "wouter";
import { useGetAssets, useCreateAsset, AssetCategory, AssetStatus } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth-context";
import { AppLayout } from "@/components/layout/app-layout";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Plus, Loader2, MonitorSmartphone } from "lucide-react";
import { format } from "date-fns";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

const createAssetSchema = z.object({
  assetTag: z.string().min(1, "Tag is required"),
  name: z.string().min(1, "Name is required"),
  category: z.nativeEnum(AssetCategory),
  status: z.nativeEnum(AssetStatus),
});

export default function AssetsList() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'administrator';
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [search, setSearch] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const { data, isLoading } = useGetAssets({
    query: {
      search: search || undefined
    }
  });

  const createMutation = useCreateAsset();

  const form = useForm<z.infer<typeof createAssetSchema>>({
    resolver: zodResolver(createAssetSchema),
    defaultValues: {
      assetTag: "",
      name: "",
      category: "laptop" as AssetCategory,
      status: "available" as AssetStatus,
    }
  });

  const onSubmit = async (values: z.infer<typeof createAssetSchema>) => {
    try {
      await createMutation.mutateAsync({ data: values });
      toast({ title: "Success", description: "Asset created successfully." });
      setIsDialogOpen(false);
      form.reset();
      queryClient.invalidateQueries({ queryKey: ['/api/assets'] });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error", description: error.message || "Failed to create asset." });
    }
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="relative max-w-md w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <Input 
              placeholder="Search assets by name or tag..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 h-11 rounded-xl bg-card border-border/50 shadow-sm"
            />
          </div>

          {isAdmin && (
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button className="h-11 rounded-xl bg-primary hover:bg-primary/90 shadow-md shadow-primary/20">
                  <Plus className="w-5 h-5 mr-2" />
                  New Asset
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[500px] p-0 overflow-hidden border-0 shadow-2xl rounded-2xl">
                <div className="px-6 py-6 bg-muted/30 border-b border-border">
                  <DialogHeader>
                    <DialogTitle className="text-2xl font-display">Add New Asset</DialogTitle>
                    <DialogDescription>Enter the details for the new inventory item.</DialogDescription>
                  </DialogHeader>
                </div>
                <div className="p-6">
                  <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
                      <div className="grid grid-cols-2 gap-4">
                        <FormField
                          control={form.control}
                          name="assetTag"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Asset Tag</FormLabel>
                              <FormControl>
                                <Input placeholder="e.g. IT-1001" {...field} className="rounded-xl" />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="name"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Name / Model</FormLabel>
                              <FormControl>
                                <Input placeholder="MacBook Pro 16" {...field} className="rounded-xl" />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4">
                        <FormField
                          control={form.control}
                          name="category"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Category</FormLabel>
                              <Select onValueChange={field.onChange} defaultValue={field.value}>
                                <FormControl>
                                  <SelectTrigger className="rounded-xl"><SelectValue placeholder="Select category" /></SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  {Object.values(AssetCategory).map(cat => (
                                    <SelectItem key={cat} value={cat} className="capitalize">{cat}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="status"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Initial Status</FormLabel>
                              <Select onValueChange={field.onChange} defaultValue={field.value}>
                                <FormControl>
                                  <SelectTrigger className="rounded-xl"><SelectValue placeholder="Select status" /></SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  {Object.values(AssetStatus).map(stat => (
                                    <SelectItem key={stat} value={stat} className="capitalize">{stat.replace('_', ' ')}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                      
                      <div className="pt-4 flex justify-end gap-3">
                        <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)} className="rounded-xl">Cancel</Button>
                        <Button type="submit" disabled={createMutation.isPending} className="rounded-xl shadow-md shadow-primary/20">
                          {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                          Save Asset
                        </Button>
                      </div>
                    </form>
                  </Form>
                </div>
              </DialogContent>
            </Dialog>
          )}
        </div>

        <div className="bg-card rounded-2xl shadow-lg shadow-black/5 border border-border/50 overflow-hidden">
          {isLoading ? (
            <div className="p-12 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
          ) : !data?.data?.length ? (
            <div className="p-16 flex flex-col items-center justify-center text-muted-foreground text-center">
              <MonitorSmartphone className="w-16 h-16 mb-4 text-muted" />
              <h3 className="text-xl font-bold text-foreground mb-2">No assets found</h3>
              <p>Try adjusting your search filters or add a new asset.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/30">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="font-semibold text-foreground/80 py-4 px-6">Tag</TableHead>
                    <TableHead className="font-semibold text-foreground/80">Asset Details</TableHead>
                    <TableHead className="font-semibold text-foreground/80">Status</TableHead>
                    <TableHead className="font-semibold text-foreground/80">Assignment</TableHead>
                    <TableHead className="font-semibold text-foreground/80 text-right px-6">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.data.map((asset) => (
                    <TableRow key={asset.id} className="hover:bg-muted/30 transition-colors group">
                      <TableCell className="font-mono text-sm px-6">
                        <span className="bg-muted px-2 py-1 rounded-md border border-border/50">{asset.assetTag}</span>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-semibold text-foreground">{asset.name}</span>
                          <span className="text-xs text-muted-foreground capitalize">{asset.category}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={asset.status} />
                      </TableCell>
                      <TableCell>
                        {asset.assignedTo ? (
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">
                              {asset.assignedTo.fullName.charAt(0)}
                            </div>
                            <span className="text-sm font-medium">{asset.assignedTo.fullName}</span>
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground italic">Unassigned</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right px-6">
                        <Link href={`/assets/${asset.id}`}>
                          <Button variant="ghost" size="sm" className="rounded-lg opacity-0 group-hover:opacity-100 transition-opacity">
                            View Details
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
