import { useState, useEffect, useMemo } from "react";
import { useGetUsers, useUpdateUser, useToggleUserActive, UserRole } from "@/lib/supabase-queries";
import { useAuth } from "@/lib/auth-context";
import { AppLayout } from "@/components/layout/app-layout";
import { PageHeader } from "@/components/layout/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Loader2, UserPlus, Users, X, KeyRound, Copy, Check } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Redirect } from "wouter";
import { supabase } from "@/lib/supabase";
import { PaginationBar } from "@/components/ui/pagination-bar";
import type { UserCardData } from "@/components/users/user-card";
import { UserTeamPanel } from "@/components/users/user-team-panel";
import { UserToolbar } from "@/components/users/user-toolbar";
import { applyUserFilter, type UserRoleFilter } from "@/components/users/user-summary-strip";

const PAGE_SIZE = 24;

function roleLabel(role: string) {
  return role.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
}

export default function UsersManagement() {
  const { user, refreshUser } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<UserRoleFilter>("all");
  const [page, setPage] = useState(1);
  const [resettingId, setResettingId] = useState<string | null>(null);
  // One-time temporary password returned by create-user / reset-password.
  // Shown exactly once in a dialog, then cleared from state — it is never
  // persisted anywhere in the UI.
  const [tempPasswordInfo, setTempPasswordInfo] = useState<
    { name: string; password: string; action: "created" | "reset" } | null
  >(null);
  const [copiedTemp, setCopiedTemp] = useState(false);
  const [addUserOpen, setAddUserOpen] = useState(false);
  const [newUser, setNewUser] = useState({ email: "", fullName: "", department: "", role: "general_user" });
  const [addingUser, setAddingUser] = useState(false);

  const { data: users, isLoading } = useGetUsers({ query: { search: search || undefined } });
  const updateMutation = useUpdateUser();
  const toggleActiveMutation = useToggleUserActive();

  const allUsers = users ?? [];

  const filteredUsers = useMemo(
    () => applyUserFilter(allUsers, roleFilter),
    [allUsers, roleFilter]
  );

  const pagedUsers = filteredUsers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [search, roleFilter]);

  if (user?.role !== "administrator") return <Redirect to="/dashboard" />;

  const handleRoleChange = async (id: string, newRole: UserRole) => {
    try {
      await updateMutation.mutateAsync({ id, data: { role: newRole } });
      toast({ title: "Role updated", description: "User permissions changed." });
      if (id === user?.id) await refreshUser();
      queryClient.invalidateQueries({ queryKey: ["users"] });
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Failed to update role." });
    }
  };

  const handleToggleActive = async (id: string, currentlyActive: boolean) => {
    try {
      await toggleActiveMutation.mutateAsync({ id, isActive: !currentlyActive });
      toast({
        title: currentlyActive ? "User deactivated" : "User activated",
        description: currentlyActive ? "User can no longer log in." : "User can now log in.",
      });
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Failed to update user status." });
    }
  };

  const handleAddUser = async () => {
    if (!newUser.email || !newUser.fullName) {
      toast({ variant: "destructive", title: "Missing fields", description: "Email and full name are required." });
      return;
    }
    setAddingUser(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-user`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify(newUser),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to create user");
      // Show the one-time temporary password exactly once (falls back to a
      // plain toast only if an older function version didn't return one).
      if (result.temporaryPassword) {
        setTempPasswordInfo({ name: newUser.fullName, password: result.temporaryPassword, action: "created" });
      } else {
        toast({ title: "User created", description: `${newUser.fullName} has been added.` });
      }
      setAddUserOpen(false);
      setNewUser({ email: "", fullName: "", department: "", role: "general_user" });
      queryClient.invalidateQueries({ queryKey: ["users"] });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed to create user.";
      toast({ variant: "destructive", title: "Error", description: message });
    } finally {
      setAddingUser(false);
    }
  };

  const handleResetPassword = async (id: string) => {
    setResettingId(id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/reset-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ userId: id }),
      });
      const result = await res.json().catch(() => ({ error: res.statusText }));
      if (!res.ok) {
        throw new Error(result.error || "Failed to reset password");
      }
      // The reset-password Edge Function flags must_change_password and
      // revokes the user's sessions server-side. It returns a fresh one-time
      // temporary password, shown exactly once below.
      const target = allUsers.find((u) => u.id === id);
      if (result.temporaryPassword) {
        setTempPasswordInfo({ name: target?.fullName ?? "User", password: result.temporaryPassword, action: "reset" });
      } else {
        toast({
          title: "Password reset",
          description: "The user will be prompted to change their password on next login.",
        });
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed to reset password.";
      toast({ variant: "destructive", title: "Error", description: message });
    } finally {
      setResettingId(null);
    }
  };

  const copyTempPassword = async () => {
    if (!tempPasswordInfo) return;
    try {
      await navigator.clipboard.writeText(tempPasswordInfo.password);
      setCopiedTemp(true);
      setTimeout(() => setCopiedTemp(false), 2000);
    } catch {
      toast({
        variant: "destructive",
        title: "Copy failed",
        description: "Please select and copy the password manually.",
      });
    }
  };

  const hasSearch = !!search;
  const hasActiveFilters = hasSearch || roleFilter !== "all";

  return (
    <AppLayout>
      <div className="space-y-5">
        {/* Header */}
        <PageHeader
          eyebrow="Administration"
          title={<>User <span className="text-primary">management</span></>}
          subtitle={
            <>
              Manage accounts, roles, and access across the organization
              {!isLoading && (
                <span className="font-medium text-foreground">
                  {" "}
                  · {allUsers.length} user{allUsers.length === 1 ? "" : "s"}
                </span>
              )}
            </>
          }
        >
          <Button className="h-10 shrink-0 rounded-xl shadow-sm" onClick={() => setAddUserOpen(true)}>
            <UserPlus className="w-4 h-4 mr-1.5" /> Add user
          </Button>
        </PageHeader>

        {/* Add user dialog */}
        <Dialog open={addUserOpen} onOpenChange={setAddUserOpen}>
          <DialogContent className="sm:max-w-[560px] rounded-2xl border-0 shadow-2xl p-0 gap-0 overflow-hidden flex max-h-[94vh] flex-col">
            <div className="relative shrink-0 px-6 py-4 border-b border-border overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.08] via-transparent to-accent/[0.06]" />
              <DialogHeader className="relative">
                <div className="flex items-center gap-3 mb-1">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15">
                    <UserPlus className="h-5 w-5" />
                  </div>
                  <DialogTitle className="text-xl font-display">Add new user</DialogTitle>
                </div>
                <DialogDescription className="pl-[52px]">
                  A secure one-time temporary password will be generated and shown to you once.
                  The user will be prompted to change it on first login.
                </DialogDescription>
              </DialogHeader>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Full name</Label>
                  <Input
                    placeholder="e.g. Juan dela Cruz"
                    value={newUser.fullName}
                    onChange={(e) => setNewUser((p) => ({ ...p, fullName: e.target.value }))}
                    className="rounded-xl h-10"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Email address</Label>
                  <Input
                    type="email"
                    placeholder="name@dost.gov.ph"
                    value={newUser.email}
                    onChange={(e) => setNewUser((p) => ({ ...p, email: e.target.value }))}
                    className="rounded-xl h-10"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Department (optional)</Label>
                  <Input
                    placeholder="e.g. MIS"
                    value={newUser.department}
                    onChange={(e) => setNewUser((p) => ({ ...p, department: e.target.value }))}
                    className="rounded-xl h-10"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Role</Label>
                  <Select value={newUser.role} onValueChange={(v) => setNewUser((p) => ({ ...p, role: v }))}>
                    <SelectTrigger className="rounded-xl h-10">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.values(UserRole).map((r) => (
                        <SelectItem key={r} value={r}>
                          {roleLabel(r)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            <div className="flex shrink-0 gap-3 border-t border-border/50 px-6 py-4">
              <Button variant="outline" className="flex-1 rounded-xl" onClick={() => setAddUserOpen(false)}>
                Cancel
              </Button>
              <Button
                className="flex-1 rounded-xl"
                disabled={addingUser || !newUser.email || !newUser.fullName}
                onClick={handleAddUser}
              >
                {addingUser ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <UserPlus className="w-4 h-4 mr-2" />}
                Create user
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* One-time temporary password — shown exactly once, never stored */}
        <Dialog
          open={!!tempPasswordInfo}
          onOpenChange={(open) => {
            if (!open) {
              setTempPasswordInfo(null);
              setCopiedTemp(false);
            }
          }}
        >
          <DialogContent className="sm:max-w-[460px] rounded-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 font-display">
                <KeyRound className="h-5 w-5 text-primary" />
                Temporary password
              </DialogTitle>
              <DialogDescription>
                {tempPasswordInfo?.action === "reset"
                  ? `The password for ${tempPasswordInfo?.name} has been reset.`
                  : `${tempPasswordInfo?.name} has been added.`}{" "}
                Give them this one-time temporary password — they will be required to change it
                when they sign in.
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/40 px-4 py-3">
              <code className="min-w-0 break-all font-mono text-sm font-semibold text-foreground">
                {tempPasswordInfo?.password}
              </code>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="shrink-0 rounded-lg"
                onClick={copyTempPassword}
              >
                {copiedTemp ? <Check className="mr-1.5 h-3.5 w-3.5" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
                {copiedTemp ? "Copied" : "Copy"}
              </Button>
            </div>
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs leading-relaxed text-amber-800 dark:border-amber-800/50 dark:bg-amber-900/10 dark:text-amber-300">
              This password is shown only once and is not stored anywhere. If you close this
              dialog without copying it, reset the password again to generate a new one.
            </p>
            <Button
              className="w-full rounded-xl"
              onClick={() => {
                setTempPasswordInfo(null);
                setCopiedTemp(false);
              }}
            >
              Done
            </Button>
          </DialogContent>
        </Dialog>

        <UserToolbar
          search={search}
          onSearchChange={setSearch}
          roleFilter={roleFilter}
          onRoleFilterChange={setRoleFilter}
          hasActiveFilters={hasActiveFilters}
          onClearFilters={() => {
            setSearch("");
            setRoleFilter("all");
          }}
        />

        {isLoading ? (
          <div className="space-y-1.5 rounded-3xl border border-primary/10 bg-card/60 p-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-[72px] rounded-2xl bg-muted/40 animate-pulse" />
            ))}
          </div>
        ) : !filteredUsers.length ? (
              <div className="flex flex-col items-center justify-center rounded-3xl border border-border/50 bg-card/75 p-16 text-center shadow-sm">
                <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/[0.08] ring-1 ring-primary/15">
                  <Users className="h-8 w-8 text-primary/60" />
                </div>
                <h3 className="mb-1.5 font-display text-lg font-semibold text-foreground">
                  {hasActiveFilters ? "No matching users" : "No users yet"}
                </h3>
                <p className="mb-6 max-w-sm text-sm leading-relaxed text-muted-foreground">
                  {hasActiveFilters
                    ? "Try adjusting your search or clearing the filters to see more users."
                    : "Add your first user to get started with team access management."}
                </p>
                {!hasActiveFilters ? (
                  <Button className="gap-2 rounded-xl" onClick={() => setAddUserOpen(true)}>
                    <UserPlus className="h-4 w-4" /> Add first user
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    className="gap-2 rounded-xl"
                    onClick={() => {
                      setSearch("");
                      setRoleFilter("all");
                    }}
                  >
                    <X className="h-4 w-4" /> Clear all filters
                  </Button>
                )}
              </div>
        ) : (
          <>
            <UserTeamPanel
              users={pagedUsers as UserCardData[]}
              total={filteredUsers.length}
              currentUserId={user?.id}
              roleUpdating={updateMutation.isPending}
              togglePending={toggleActiveMutation.isPending}
              resettingId={resettingId}
              onRoleChange={handleRoleChange}
              onToggleActive={handleToggleActive}
              onResetPassword={handleResetPassword}
            />
            {filteredUsers.length > PAGE_SIZE && (
              <div className="overflow-hidden rounded-2xl border border-border/50 bg-card/70 shadow-sm">
                <PaginationBar page={page} pageSize={PAGE_SIZE} total={filteredUsers.length} onPage={setPage} />
              </div>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}
