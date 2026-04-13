import { useState } from "react";
import { useGetCategories, useCreateCategory, useDeleteCategory } from "@/lib/supabase-queries";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Plus, Trash2, Loader2, Tags } from "lucide-react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Redirect } from "wouter";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/ui/page-header";

const createCategorySchema = z.object({
  name: z.string().min(1, "Name is required"),
  type: z.string().min(1, "Type is required"),
});

export default function CategoriesManagement() {
  const { user } = useAuth();
  if (user?.role !== 'administrator') return <Redirect to="/dashboard" />;

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const { data: categories, isLoading } = useGetCategories();
  const createMutation = useCreateCategory();
  const deleteMutation = useDeleteCategory();

  const form = useForm<z.infer<typeof createCategorySchema>>({
    resolver: zodResolver(createCategorySchema),
    defaultValues: { name: "", type: "asset" }
  });

  const onSubmit = async (values: z.infer<typeof createCategorySchema>) => {
    try {
      await createMutation.mutateAsync({ data: values });
      toast({ title: "Success", description: "Category created." });
      setIsDialogOpen(false);
      form.reset();
      queryClient.invalidateQueries({ queryKey: ['/api/categories'] });
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: "Failed to create category." });
    }
  };

  const handleDelete = async (id: string) => {
    if(!confirm('Delete this category?')) return;
    try {
      await deleteMutation.mutateAsync({ id });
      toast({ title: "Deleted", description: "Category removed." });
      queryClient.invalidateQueries({ queryKey: ['/api/categories'] });
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: "Failed to delete category." });
    }
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <PageHeader
          title="Categories"
          subtitle="Define custom categories for asset classification"
          action={
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button className="h-10 rounded-xl bg-primary hover:bg-primary/90 shadow-md shadow-primary/20">
                  <Plus className="w-4 h-4 mr-2" /> Add Category
                </Button>
              </DialogTrigger>
            <DialogContent className="sm:max-w-[400px] rounded-2xl border-0 shadow-2xl">
              <DialogHeader>
                <DialogTitle>New Category</DialogTitle>
                <DialogDescription>Define a new category for assets.</DialogDescription>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
                  <FormField control={form.control} name="name" render={({ field }) => (
                    <FormItem><FormLabel>Category Name</FormLabel><FormControl><Input placeholder="e.g. Peripherals" {...field} className="rounded-xl"/></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="type" render={({ field }) => (
                    <FormItem><FormLabel>Type Identifier</FormLabel><FormControl><Input placeholder="e.g. asset" {...field} className="rounded-xl"/></FormControl><FormMessage /></FormItem>
                  )} />
                  <div className="flex justify-end pt-4">
                    <Button type="submit" disabled={createMutation.isPending} className="rounded-xl shadow-md shadow-primary/20">
                      {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save
                    </Button>
                  </div>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
          }
        />

        <Card className="border-border/50 shadow-lg shadow-black/5 rounded-2xl overflow-hidden">
          {isLoading ? (
             <div className="p-12 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
          ) : !categories?.length ? (
            <div className="p-12 text-center text-muted-foreground flex flex-col items-center"><Tags className="w-12 h-12 mb-4 opacity-20"/> No custom categories found.</div>
          ) : (
            <Table>
              <TableHeader className="bg-muted/30">
                <TableRow>
                  <TableHead className="px-6 py-4">Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right px-6">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {categories.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="px-6 font-medium">{c.name}</TableCell>
                    <TableCell className="text-muted-foreground text-sm font-mono">{c.type}</TableCell>
                    <TableCell className="text-right px-6">
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(c.id)} className="text-destructive hover:bg-destructive/10 hover:text-destructive rounded-lg">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>
    </AppLayout>
  );
}
