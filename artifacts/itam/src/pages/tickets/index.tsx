import { useState } from "react";
import { Link } from "wouter";
import { useGetTickets, useCreateTicket, TicketPriority, useGetAssets } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/app-layout";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Search, Plus, Loader2, TicketIcon } from "lucide-react";
import { format } from "date-fns";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

const createTicketSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().min(1, "Description is required"),
  priority: z.nativeEnum(TicketPriority),
  assetId: z.string().optional().nullable(),
});

export default function TicketsList() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const { data, isLoading } = useGetTickets({ query: { search: search || undefined } });
  const { data: assets } = useGetAssets(); // for dropdown
  const createMutation = useCreateTicket();

  const form = useForm<z.infer<typeof createTicketSchema>>({
    resolver: zodResolver(createTicketSchema),
    defaultValues: { title: "", description: "", priority: "low" as TicketPriority, assetId: null }
  });

  const onSubmit = async (values: z.infer<typeof createTicketSchema>) => {
    try {
      await createMutation.mutateAsync({ data: values });
      toast({ title: "Success", description: "Ticket created." });
      setIsDialogOpen(false);
      form.reset();
      queryClient.invalidateQueries({ queryKey: ['/api/tickets'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/stats'] });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error", description: error.message || "Failed to create ticket." });
    }
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="relative max-w-md w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <Input 
              placeholder="Search tickets..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 h-11 rounded-xl bg-card border-border/50 shadow-sm"
            />
          </div>

          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button className="h-11 rounded-xl bg-primary hover:bg-primary/90 shadow-md shadow-primary/20">
                <Plus className="w-5 h-5 mr-2" /> New Ticket
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
                              {Object.values(TicketPriority).map(p => <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="assetId" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Related Asset (Optional)</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value || undefined}>
                            <FormControl><SelectTrigger className="rounded-xl"><SelectValue placeholder="None" /></SelectTrigger></FormControl>
                            <SelectContent>
                              <SelectItem value="">None</SelectItem>
                              {assets?.data?.map(a => <SelectItem key={a.id} value={a.id}>{a.name} ({a.assetTag})</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>
                    <FormField control={form.control} name="description" render={({ field }) => (
                      <FormItem><FormLabel>Description</FormLabel><FormControl><Textarea placeholder="Detailed explanation..." {...field} className="rounded-xl min-h-[120px]" /></FormControl><FormMessage /></FormItem>
                    )} />
                    <div className="pt-4 flex justify-end gap-3">
                      <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)} className="rounded-xl">Cancel</Button>
                      <Button type="submit" disabled={createMutation.isPending} className="rounded-xl shadow-md shadow-primary/20">
                        {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Submit Ticket
                      </Button>
                    </div>
                  </form>
                </Form>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <div className="bg-card rounded-2xl shadow-lg shadow-black/5 border border-border/50 overflow-hidden">
          {isLoading ? (
            <div className="p-12 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
          ) : !data?.data?.length ? (
            <div className="p-16 flex flex-col items-center justify-center text-muted-foreground text-center">
              <TicketIcon className="w-16 h-16 mb-4 text-muted" />
              <h3 className="text-xl font-bold text-foreground mb-2">No tickets found</h3>
              <p>Everything is running smoothly, or try clearing search filters.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/30">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="font-semibold text-foreground/80 py-4 px-6">Ticket</TableHead>
                    <TableHead className="font-semibold text-foreground/80">Status & Priority</TableHead>
                    <TableHead className="font-semibold text-foreground/80">Requester</TableHead>
                    <TableHead className="font-semibold text-foreground/80">Created</TableHead>
                    <TableHead className="font-semibold text-foreground/80 text-right px-6">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.data.map((ticket) => (
                    <TableRow key={ticket.id} className="hover:bg-muted/30 transition-colors group">
                      <TableCell className="px-6 py-4">
                        <div className="flex flex-col max-w-[300px]">
                          <span className="font-semibold text-foreground truncate" title={ticket.title}>{ticket.title}</span>
                          <span className="text-xs text-muted-foreground font-mono mt-1">#{ticket.id.substring(0,8)}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col items-start gap-2">
                          <StatusBadge status={ticket.status} />
                          <StatusBadge status={ticket.priority} />
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-accent/10 text-accent flex items-center justify-center text-xs font-bold">
                            {ticket.createdBy.fullName.charAt(0)}
                          </div>
                          <span className="text-sm font-medium">{ticket.createdBy.fullName}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {format(new Date(ticket.createdAt), 'MMM d, yyyy')}
                      </TableCell>
                      <TableCell className="text-right px-6">
                        <Link href={`/tickets/${ticket.id}`}>
                          <Button variant="outline" size="sm" className="rounded-lg shadow-sm hover:bg-primary hover:text-primary-foreground hover:border-primary transition-all">
                            Open
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
