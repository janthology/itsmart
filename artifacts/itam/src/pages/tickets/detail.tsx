import { useState } from "react";
import { useRoute, Link } from "wouter";
import { useGetTicket, useUpdateTicket, useAddTicketComment, TicketStatus, TicketPriority } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth-context";
import { AppLayout } from "@/components/layout/app-layout";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, ArrowLeft, Send, MessageSquare, Clock, ShieldAlert, MonitorSmartphone } from "lucide-react";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export default function TicketDetail() {
  const [, params] = useRoute("/tickets/:id");
  const id = params?.id || "";
  const { user } = useAuth();
  const canManage = user?.role === 'administrator' || user?.role === 'support_staff';
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: ticket, isLoading, isError } = useGetTicket(id);
  const updateMutation = useUpdateTicket();
  const commentMutation = useAddTicketComment();

  const [commentText, setCommentText] = useState("");

  const handleStatusChange = async (newStatus: string) => {
    try {
      await updateMutation.mutateAsync({ id, data: { status: newStatus as TicketStatus } });
      toast({ title: "Status updated", description: "Ticket status has been changed." });
      queryClient.invalidateQueries({ queryKey: [`/api/tickets/${id}`] });
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: "Failed to update status." });
    }
  };

  const handleAddComment = async () => {
    if (!commentText.trim()) return;
    try {
      await commentMutation.mutateAsync({ id, data: { commentText } });
      setCommentText("");
      queryClient.invalidateQueries({ queryKey: [`/api/tickets/${id}`] });
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: "Failed to add comment." });
    }
  };

  if (isLoading) return <AppLayout><div className="flex h-64 items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div></AppLayout>;
  if (isError || !ticket) return <AppLayout><div className="text-center p-8 text-destructive">Ticket not found.</div></AppLayout>;

  return (
    <AppLayout>
      <div className="space-y-6 max-w-5xl mx-auto">
        <Link href="/tickets" className="inline-flex items-center text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to Tickets
        </Link>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            <Card className="border-border/50 shadow-lg shadow-black/5 rounded-2xl overflow-hidden">
              <CardHeader className="bg-muted/20 border-b border-border/50 pb-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="space-y-1">
                    <p className="text-sm font-mono text-muted-foreground">Ticket #{ticket.id.substring(0,8)}</p>
                    <CardTitle className="text-2xl font-display leading-tight">{ticket.title}</CardTitle>
                  </div>
                  <div className="flex flex-col gap-2 items-end">
                    <StatusBadge status={ticket.priority} />
                    <StatusBadge status={ticket.status} />
                  </div>
                </div>
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1.5"><Clock className="w-4 h-4" /> Opened {format(new Date(ticket.createdAt), 'MMM d, h:mm a')}</span>
                  <span className="flex items-center gap-1.5 px-2 py-1 bg-background rounded-md border border-border/50">
                    <span className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-[10px]">{ticket.createdBy.fullName.charAt(0)}</span>
                    {ticket.createdBy.fullName}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="p-8">
                <div className="prose dark:prose-invert max-w-none">
                  <p className="whitespace-pre-wrap leading-relaxed">{ticket.description}</p>
                </div>
              </CardContent>
            </Card>

            {/* Comments Section */}
            <div className="space-y-6">
              <h3 className="text-lg font-bold font-display flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-primary" /> Activity Log
              </h3>
              
              <div className="space-y-4">
                {ticket.comments.map((comment) => (
                  <Card key={comment.id} className="border-border/50 shadow-sm rounded-xl">
                    <CardHeader className="py-3 px-4 bg-muted/20 border-b border-border/50 flex flex-row items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-accent/10 text-accent flex items-center justify-center font-bold text-xs">
                          {comment.createdBy.fullName.charAt(0)}
                        </div>
                        <span className="font-semibold text-sm">{comment.createdBy.fullName}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">{format(new Date(comment.createdAt), 'MMM d, h:mm a')}</span>
                    </CardHeader>
                    <CardContent className="p-4 text-sm whitespace-pre-wrap">
                      {comment.commentText}
                    </CardContent>
                  </Card>
                ))}
              </div>

              <Card className="border-primary/20 shadow-md shadow-primary/5 rounded-xl border-2">
                <CardContent className="p-4">
                  <Textarea 
                    placeholder="Type your reply here..." 
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    className="min-h-[100px] mb-4 border-border/50 focus-visible:ring-primary/20 rounded-lg resize-none"
                  />
                  <div className="flex justify-end">
                    <Button 
                      onClick={handleAddComment} 
                      disabled={!commentText.trim() || commentMutation.isPending}
                      className="rounded-lg shadow-md shadow-primary/20"
                    >
                      {commentMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
                      Send Reply
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Sidebar Info */}
          <div className="space-y-6">
            {canManage && (
              <Card className="border-border/50 shadow-lg shadow-black/5 rounded-2xl">
                <CardHeader className="border-b border-border/50 py-4 px-6"><CardTitle className="text-base font-display flex items-center gap-2"><ShieldAlert className="w-5 h-5 text-primary" /> Management</CardTitle></CardHeader>
                <CardContent className="p-6 space-y-4">
                  <div>
                    <label className="text-sm font-medium mb-1.5 block text-foreground">Update Status</label>
                    <Select value={ticket.status} onValueChange={handleStatusChange} disabled={updateMutation.isPending}>
                      <SelectTrigger className="w-full rounded-xl">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.values(TicketStatus).map(s => <SelectItem key={s} value={s} className="capitalize">{s.replace('_', ' ')}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>
            )}

            {ticket.asset && (
              <Card className="border-border/50 shadow-lg shadow-black/5 rounded-2xl overflow-hidden group">
                <div className="bg-primary/5 p-4 border-b border-border/50 flex justify-center">
                  <MonitorSmartphone className="w-12 h-12 text-primary opacity-80 group-hover:scale-110 transition-transform duration-300" />
                </div>
                <CardContent className="p-6 space-y-3">
                  <h4 className="font-bold font-display text-lg leading-tight">{ticket.asset.name}</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">Tag:</span> <span className="font-mono bg-muted px-1.5 py-0.5 rounded">{ticket.asset.assetTag}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Category:</span> <span className="capitalize">{ticket.asset.category}</span></div>
                    <div className="flex justify-between items-center"><span className="text-muted-foreground">Asset Status:</span> <StatusBadge status={ticket.asset.status} /></div>
                  </div>
                </CardContent>
                {canManage && (
                  <CardFooter className="p-4 pt-0 border-t border-border/50 mt-4 bg-muted/10">
                    <Link href={`/assets/${ticket.asset.id}`} className="w-full">
                      <Button variant="outline" className="w-full rounded-xl">View Asset Details</Button>
                    </Link>
                  </CardFooter>
                )}
              </Card>
            )}
          </div>

        </div>
      </div>
    </AppLayout>
  );
}
