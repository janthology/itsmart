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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Search, Loader2, UserCog, UserCheck, UserX, KeyRound, UserPlus } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Redirect } from "wouter";
import { supabase } from "@/lib/supabase";
import { SkeletonTable } from "@/components/ui/skeleton-table";

export default function UsersManagement() {
  const { user, refreshUser } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [addUserOpen, setAddUserOpen] = useState(false);
  const [newUser, setNewUser] = useState({ email: "", fullName: "", department: "", role: "general_user" });
  const [addingUser, setAddingUser] = useState(false);

  const { data: users, isLoading } = useGetUsers({ query: { search: search || undefined } });
  const updateMutation = useUpdateUser();
  const toggleActiveMutation = useToggleUserActive();

  // Role guard — after all hooks to satisfy Rules of Hooks
  if (user?.role !== 'administrator') return <Redirect to="/dashboard" />;

  const handleRoleChange = async (id: string, newRole: UserRole) => {
    try {
      await updateMutation.mutateAsync({ id, data: { role: newRole } });
      toast({ title: "Role updated", description: "User permissions changed." });
      if (id === user?.id) await refreshUser();
      queryClient.invalidateQueries({ queryKey: ['users'] });
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

  // ── Add User ──────────────────────────────────────────────────────────────
  const handleAddUser = async () => {
    if (!newUser.email || !newUser.fullName) {
      toast({ variant: "destructive", title: "Missing fields", description: "Email and full name are required." });
      return;
    }
    setAddingUser(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-user`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session?.access_token}`,
            "apikey": import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify(newUser),
        }
      );
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to create user");
      toast({ title: "User created", description: `${newUser.fullName} has been added. Default password is "dostro2".` });
      setAddUserOpen(false);
      setNewUser({ email: "", fullName: "", department: "", role: "general_user" });
      queryClient.invalidateQueries({ queryKey: ['users'] });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e.message || "Failed to create user." });
    } finally {
      setAddingUser(false);
    }
  };

  const handleResetPassword = async (id: string) => {
    setResettingId(id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/reset-password`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session?.access_token}`,
            "apikey": import.meta.env.VITE_SUPABASE_ANON_KEY,
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

        {/* Add User Dialog */}
        <Dialog open={addUserOpen} onOpenChange={setAddUserOpen}>
          <DialogContent className="sm:max-w-[460px] rounded-2xl border-0 shadow-2xl p-0">
            <div className="px-6 py-6 bg-muted/30 border-b border-border">
              <DialogHeader>
                <DialogTitle className="text-xl font-display">Add New User</DialogTitle>
                <DialogDescription>Create an account with the default password <span className="font-mono font-semibold text-foreground">dostro2</span>. The user will be prompted to change it on first login.</DialogDescription>
              </DialogHeader>
            </div>
            <div className="p-6 space-y-4">
              <div className="space-y-1.5">
                <Label>Full Name</Label>
                <Input placeholder="e.g. Juan dela Cruz" value={newUser.fullName} onChange={e => setNewUser(p => ({ ...p, fullName: e.target.value }))} className="rounded-xl h-11" />
              </div>
              <div className="space-y-1.5">
                <Label>Email Address</Label>
                <Input type="email" placeholder="name@dost.gov.ph" value={newUser.email} onChange={e => setNewUser(p => ({ ...p, email: e.target.value }))} className="rounded-xl h-11" />
              </div>
              <div className="space-y-1.5">
                <Label>Department (Optional)</Label>
                <Input placeholder="e.g. MIS" value={newUser.department} onChange={e => setNewUser(p => ({ ...p, department: e.target.value }))} className="rounded-xl h-11" />
              </div>
              <div className="space-y-1.5">
                <Label>Role</Label>
                <Select value={newUser.role} onValueChange={v => setNewUser(p => ({ ...p, role: v }))}>
                  <SelectTrigger className="rounded-xl h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.values(UserRole).map(r => (
                      <SelectItem key={r} value={r}>{r.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-3 pt-2">
                <Button variant="outline" className="flex-1 rounded-xl" onClick={() => setAddUserOpen(false)}>Cancel</Button>
                <Button className="flex-1 rounded-xl" disabled={addingUser || !newUser.email || !newUser.fullName} onClick={handleAddUser}>
                  {addingUser ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <UserPlus className="w-4 h-4 mr-2" />}
                  Create User
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
        <div className="flex items-center gap-2 max-w-xl">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <Input
              placeholder="Search users..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 h-11 rounded-xl bg-card border-border/50 shadow-sm"
            />
          </div>
          <Button className="h-11 rounded-xl gap-2 shrink-0" onClick={() => setAddUserOpen(true)}>
            <UserPlus className="w-4 h-4" /> Add User
          </Button>
        </div>

        <Card className="border-border/50 shadow-lg shadow-black/5 rounded-2xl overflow-hidden">
          {isLoading ? (
            <SkeletonTable rows={5} cols={6} />
          ) : (
            <Table>
              <TableHeader className="bg-muted/30">
                <TableRow>
                  <TableHead className="py-4 px-6">User</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead>Last Login</TableHead>
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
                    <TableCell className="text-sm text-muted-foreground">
                      {(u as any).lastSignInAt
                        ? <span title={format(new Date((u as any).lastSignInAt), 'MMM d, yyyy h:mm a')}>{formatDistanceToNow(new Date((u as any).lastSignInAt), { addSuffix: true })}</span>
                        : <span className="italic">Never</span>}
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

