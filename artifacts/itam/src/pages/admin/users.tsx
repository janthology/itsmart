import { useState } from "react";
import { useGetUsers, useUpdateUser, useToggleUserActive, UserRole } from "@/lib/supabase-queries";
import { useAuth } from "@/lib/auth-context";
import { AppLayout } from "@/components/layout/app-layout";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Search, Loader2, UserCog, UserCheck, UserX, KeyRound } from "lucide-react";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Redirect } from "wouter";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/ui/page-header";

export default function UsersManagement() {
  const { user, refreshUser } = useAuth();
  if (user?.role !== 'administrator') return <Redirect to="/dashboard" />;

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");

  const { data: users, isLoading } = useGetUsers({ query: { search: search || undefined } });
  const updateMutation = useUpdateUser();
  const toggleActiveMutation = useToggleUserActive();

  const handleRoleChange = async (id: string, newRole: UserRole) => {
    try {
      await updateMutation.mutateAsync({ id, data: { role: newRole } });
      toast({ title: "Role updated", description: "User permissions changed." });
      if (id === user?.id) await refreshUser();
      queryClient.invalidateQueries({ queryKey: ['/api/users'] });
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: "Failed to update role." });
    }
  };

  const handleToggleActive = async (id: string, currentlyActive: boolean) => {
    try {
      await toggleActiveMutation.mutateAsync({ id, isActive: !currentlyActive });
      toast({ title: currentlyActive ? "User deactivated" : "User activated", description: currentlyActive ? "User can no longer log in." : "User can now log in." });
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: "Failed to update user status." });
    }
  };

  const [resettingId, setResettingId] = useState<string | null>(null);

  const handleResetPassword = async (id: string) => {
    setResettingId(id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        "https://wngurnuozjzzdhveegjz.supabase.co/functions/v1/reset-password",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session?.access_token}`,
            "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InduZ3VybnVvemp6emRodmVlZ2p6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5OTEzMjksImV4cCI6MjA4OTU2NzMyOX0.4Egd_5WWeZc7yivsQre4IVrIk25igJ0rRsCbwpimyXo",
          },
          body: JSON.stringify({ userId: id }),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || "Failed to reset password");
      }
      // Mark user as needing to change password on next login
      await supabase.from("profiles").update({ must_change_password: true }).eq("id", id);
      toast({ title: "Password reset", description: 'Password reset to "dostro2". User will be prompted to change it on next login.' });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e.message || "Failed to reset password." });
    } finally {
      setResettingId(null);
    }
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <PageHeader title="Users" subtitle="Manage user accounts, roles, and access" />
        <div className="flex items-center justify-between">
          <div className="relative max-w-md w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <Input 
              placeholder="Search users..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 h-11 rounded-xl bg-card border-border/50 shadow-sm"
            />
          </div>
        </div>

        <Card className="border-border/50 shadow-lg shadow-black/5 rounded-2xl overflow-hidden">
          {isLoading ? (
             <div className="p-12 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
          ) : (
            <Table>
              <TableHeader className="bg-muted/30">
                <TableRow>
                  <TableHead className="py-4 px-6">User</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="px-6">Role / Access Level</TableHead>
                  <TableHead className="px-6">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users?.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold">
                          {u.fullName.charAt(0)}
                        </div>
                        <div>
                          <p className="font-bold text-foreground">{u.fullName}</p>
                          <p className="text-xs text-muted-foreground">{u.email}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {u.department ? <Badge variant="secondary" className="rounded-md font-normal">{u.department}</Badge> : <span className="text-muted-foreground text-sm">-</span>}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {format(new Date(u.createdAt), 'MMM yyyy')}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className={`rounded-md text-xs font-medium ${(u as any).isActive !== false ? 'border-green-300 text-green-700 bg-green-50 dark:bg-green-900/20 dark:text-green-400' : 'border-red-300 text-red-700 bg-red-50 dark:bg-red-900/20 dark:text-red-400'}`}>
                          {(u as any).isActive !== false ? 'Active' : 'Inactive'}
                        </Badge>
                        {u.id !== user?.id && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className={`h-7 px-2 rounded-lg text-xs ${(u as any).isActive !== false ? 'text-red-600 hover:bg-red-50 hover:text-red-700' : 'text-green-600 hover:bg-green-50 hover:text-green-700'}`}
                            disabled={toggleActiveMutation.isPending}
                            onClick={() => handleToggleActive(u.id, (u as any).isActive !== false)}
                          >
                            {(u as any).isActive !== false
                              ? <><UserX className="w-3 h-3 mr-1" />Deactivate</>
                              : <><UserCheck className="w-3 h-3 mr-1" />Activate</>}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="px-6">
                      <Select 
                        value={u.role} 
                        onValueChange={(val) => handleRoleChange(u.id, val as UserRole)}
                        disabled={updateMutation.isPending || u.id === user?.id}
                      >
                        <SelectTrigger className="w-[180px] h-9 rounded-lg border-border/50 bg-background text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.values(UserRole).map(r => (
                            <SelectItem key={r} value={r} className="capitalize flex items-center">
                              {r === 'administrator' && <UserCog className="w-3 h-3 inline mr-2 text-destructive" />}
                              {r.replace('_', ' ')}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="px-6">
                      {u.id !== user?.id && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="outline" size="sm" className="h-8 rounded-lg gap-1.5 text-xs text-amber-700 border-amber-300 hover:bg-amber-50 dark:text-amber-400 dark:border-amber-700 dark:hover:bg-amber-900/20">
                              <KeyRound className="w-3 h-3" /> Reset Password
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent className="rounded-2xl">
                            <AlertDialogHeader>
                              <AlertDialogTitle>Reset password for {u.fullName}?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will set their password to <span className="font-mono font-semibold text-foreground">dostro2</span>. They should change it after logging in.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel className="rounded-xl">Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                className="rounded-xl bg-amber-600 hover:bg-amber-700 text-white"
                                onClick={() => handleResetPassword(u.id)}
                                disabled={resettingId === u.id}
                              >
                                {resettingId === u.id ? <Loader2 className="w-4 h-4 animate-spin" /> : "Reset Password"}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
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
