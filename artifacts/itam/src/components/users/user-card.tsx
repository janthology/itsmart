import { format, formatDistanceToNow } from "date-fns";
import { roleLabel } from "@/lib/labels";
import { UserCog, Headphones, User, KeyRound, UserCheck, UserX, Loader2, Mail, Building2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { UserRole } from "@/lib/supabase-queries";
import { cn } from "@/lib/utils";

export interface UserCardData {
  id: string;
  fullName: string;
  email: string;
  role: string;
  department?: string | null;
  createdAt: string;
  isActive?: boolean;
  lastSignInAt?: string | null;
}

interface UserCardProps {
  user: UserCardData;
  isCurrentUser: boolean;
  roleUpdating: boolean;
  togglePending: boolean;
  resetting: boolean;
  onRoleChange: (role: UserRole) => void;
  onToggleActive: () => void;
  onResetPassword: () => void;
}

function roleAccent(role: string) {
  if (role === "administrator") return "from-red-500/90 via-red-400/70 to-red-500/40";
  if (role === "support_staff") return "from-sky-500/80 via-sky-400/60 to-sky-500/30";
  return "from-violet-400/80 via-violet-300/60 to-violet-400/30";
}


function RoleIcon({ role, className }: { role: string; className?: string }) {
  if (role === "administrator") return <UserCog className={className} />;
  if (role === "support_staff") return <Headphones className={className} />;
  return <User className={className} />;
}

function roleBadgeStyle(role: string) {
  if (role === "administrator") return "bg-red-500/10 text-red-700 border-red-200/60";
  if (role === "support_staff") return "bg-sky-500/10 text-sky-700 border-sky-200/60";
  return "bg-violet-500/10 text-violet-700 border-violet-200/60";
}

export function UserCard({
  user,
  isCurrentUser,
  roleUpdating,
  togglePending,
  resetting,
  onRoleChange,
  onToggleActive,
  onResetPassword,
}: UserCardProps) {
  const active = user.isActive !== false;
  const lastLogin = user.lastSignInAt
    ? formatDistanceToNow(new Date(user.lastSignInAt), { addSuffix: true })
    : null;

  return (
    <article
      className={cn(
        "group relative flex h-full flex-col overflow-hidden rounded-2xl border border-border/60 bg-card",
        "shadow-[0_1px_3px_rgba(53,88,114,0.05)] transition-all duration-200",
        "hover:border-primary/30 hover:shadow-[0_12px_32px_rgba(53,88,114,0.1)] hover:-translate-y-1",
        !active && "opacity-85"
      )}
    >
      <div className={cn("h-1 w-full bg-gradient-to-r shrink-0", roleAccent(user.role))} />

      <div className="flex flex-1 flex-col p-5 gap-4">
        <div className="flex items-start gap-3">
          <Avatar className="h-12 w-12 ring-2 ring-primary/10 shadow-sm shrink-0 transition-transform group-hover:scale-105">
            <AvatarFallback className="bg-primary/10 text-primary font-bold text-sm">
              {user.fullName.charAt(0)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <h3 className="font-display font-semibold text-[15px] text-foreground truncate group-hover:text-primary transition-colors">
                {user.fullName}
              </h3>
              {isCurrentUser && (
                <Badge variant="secondary" className="text-[10px] h-5 px-1.5 rounded-md">You</Badge>
              )}
            </div>
            <p className="flex items-center gap-1 text-xs text-muted-foreground truncate mt-1">
              <Mail className="h-3 w-3 shrink-0 opacity-60" />
              {user.email}
            </p>
          </div>
          <Badge
            variant="outline"
            className={cn(
              "shrink-0 text-[10px] font-semibold rounded-md",
              active
                ? "border-emerald-200 text-emerald-700 bg-emerald-50 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-800/50"
                : "border-red-200 text-red-700 bg-red-50 dark:bg-red-950/30 dark:text-red-300 dark:border-red-800/50"
            )}
          >
            {active ? "Active" : "Inactive"}
          </Badge>
        </div>

        <div className="flex flex-wrap gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-lg border capitalize",
              roleBadgeStyle(user.role)
            )}
          >
            <RoleIcon role={user.role} className="w-3.5 h-3.5" />
            {roleLabel(user.role)}
          </span>
          {user.department && (
            <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-lg bg-muted/50 border border-border/50 text-muted-foreground">
              <Building2 className="w-3 h-3" />
              {user.department}
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-xl bg-muted/40 border border-border/40 px-3 py-2.5">
            <p className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">Joined</p>
            <p className="font-semibold text-foreground mt-1">{format(new Date(user.createdAt), "MMM yyyy")}</p>
          </div>
          <div className="rounded-xl bg-muted/40 border border-border/40 px-3 py-2.5">
            <p className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">Last login</p>
            <p
              className="font-semibold text-foreground mt-1 truncate"
              title={user.lastSignInAt ? format(new Date(user.lastSignInAt), "MMM d, yyyy h:mm a") : undefined}
            >
              {lastLogin ?? "Never"}
            </p>
          </div>
        </div>

        <div className="mt-auto pt-3 border-t border-border/50 space-y-3">
          <div className="rounded-xl bg-muted/30 border border-border/40 p-3 space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Assign role</p>
            <Select
              value={user.role}
              onValueChange={(val) => onRoleChange(val as UserRole)}
              disabled={roleUpdating || isCurrentUser}
            >
              <SelectTrigger className="w-full h-9 rounded-xl text-sm border-border/60 bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.values(UserRole).map((r) => (
                  <SelectItem key={r} value={r} className="capitalize">
                    {roleLabel(r)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {!isCurrentUser && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  "flex-1 min-w-[120px] h-8 rounded-xl text-xs gap-1.5",
                  active
                    ? "text-red-600 border-red-200 hover:bg-red-50 dark:hover:bg-red-950/20"
                    : "text-emerald-600 border-emerald-200 hover:bg-emerald-50 dark:hover:bg-emerald-950/20"
                )}
                disabled={togglePending}
                onClick={onToggleActive}
              >
                {togglePending ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : active ? (
                  <>
                    <UserX className="w-3 h-3" /> Deactivate
                  </>
                ) : (
                  <>
                    <UserCheck className="w-3 h-3" /> Activate
                  </>
                )}
              </Button>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 min-w-[120px] h-8 rounded-xl text-xs gap-1.5 text-amber-700 border-amber-200 hover:bg-amber-50 dark:text-amber-400 dark:border-amber-800/50 dark:hover:bg-amber-950/20"
                    disabled={resetting}
                  >
                    {resetting ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <KeyRound className="w-3 h-3" />
                    )}
                    Reset pwd
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="rounded-2xl">
                  <AlertDialogHeader>
                    <AlertDialogTitle className="font-display">Reset password for {user.fullName}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      A new secure temporary password will be generated and shown to you once.
                      They will be prompted to change it on next login.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel className="rounded-xl">Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="rounded-xl bg-amber-600 hover:bg-amber-700 text-white"
                      onClick={onResetPassword}
                    >
                      Reset password
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
