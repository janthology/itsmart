import { format, formatDistanceToNow } from "date-fns";
import { roleLabel } from "@/lib/labels";
import { motion } from "framer-motion";
import {
  UserCog,
  Headphones,
  User,
  KeyRound,
  UserCheck,
  UserX,
  Loader2,
  Mail,
  Building2,
  Clock,
  MoreHorizontal,
  Check,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { UserRole } from "@/lib/supabase-queries";
import { cn } from "@/lib/utils";
import type { UserCardData } from "@/components/users/user-card";


function RoleIcon({ role, className }: { role: string; className?: string }) {
  if (role === "administrator") return <UserCog className={className} />;
  if (role === "support_staff") return <Headphones className={className} />;
  return <User className={className} />;
}

const STATUS_DOT: Record<string, string> = {
  active: "bg-emerald-500",
  inactive: "bg-slate-400",
};

interface UserRowProps {
  user: UserCardData;
  isCurrentUser: boolean;
  roleUpdating: boolean;
  togglePending: boolean;
  resetting: boolean;
  onRoleChange: (role: UserRole) => void;
  onToggleActive: () => void;
  onResetPassword: () => void;
  index?: number;
}

export function UserRow({
  user,
  isCurrentUser,
  roleUpdating,
  togglePending,
  resetting,
  onRoleChange,
  onToggleActive,
  onResetPassword,
  index = 0,
}: UserRowProps) {
  const [resetOpen, setResetOpen] = useState(false);
  const active = user.isActive !== false;
  const statusDot = active ? STATUS_DOT.active : STATUS_DOT.inactive;
  const lastLogin = user.lastSignInAt
    ? formatDistanceToNow(new Date(user.lastSignInAt), { addSuffix: true })
    : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: Math.min(index * 0.03, 0.3) }}
    >
      <article
        className={cn(
          "group flex items-center gap-3 rounded-2xl border border-primary/8 bg-white/70 px-3 py-3.5 transition-all sm:gap-4 sm:px-4",
          "hover:border-primary/20 hover:bg-white hover:shadow-[0_8px_24px_rgba(53,88,114,0.08)] hover:-translate-y-px",
          !active && "opacity-80"
        )}
      >
        {/* Avatar + status */}
        <div className="relative shrink-0">
          <Avatar className="h-11 w-11 ring-2 ring-primary/10 transition-transform group-hover:scale-[1.02]">
            <AvatarFallback className="bg-primary/10 text-primary text-sm font-bold">
              {user.fullName.charAt(0)}
            </AvatarFallback>
          </Avatar>
          <span
            className={cn(
              "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-white shadow-sm",
              statusDot
            )}
            title={active ? "Active" : "Inactive"}
          />
        </div>

        {/* Grid — same rhythm as asset rows */}
        <div className="min-w-0 flex-1 grid gap-2 sm:grid-cols-[minmax(0,1.5fr)_minmax(0,0.7fr)_minmax(0,0.65fr)_auto] sm:items-center sm:gap-3">
          {/* Member */}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex max-w-full items-center gap-1 rounded-md bg-primary/[0.07] px-2 py-0.5 font-mono text-[10px] font-semibold text-primary ring-1 ring-primary/10 truncate">
                <Mail className="h-3 w-3 shrink-0 opacity-70" />
                <span className="truncate">{user.email}</span>
              </span>
              {isCurrentUser && (
                <Badge variant="secondary" className="h-5 rounded-md px-1.5 text-[10px]">You</Badge>
              )}
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1",
                  active
                    ? "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20"
                    : "bg-rose-500/10 text-rose-600 ring-rose-500/20"
                )}
              >
                {active ? "Active" : "Inactive"}
              </span>
            </div>
            <h3 className="mt-1 truncate font-display text-[15px] font-semibold text-foreground group-hover:text-primary transition-colors">
              {user.fullName}
            </h3>
            <p className="text-xs text-muted-foreground">
              Joined {format(new Date(user.createdAt), "MMM yyyy")}
            </p>
          </div>

          {/* Role */}
          <div className="flex items-center min-w-0 sm:px-1">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/[0.06] px-2.5 py-1 text-xs font-medium text-primary ring-1 ring-primary/10 capitalize">
              <RoleIcon role={user.role} className="h-3 w-3 shrink-0" />
              {roleLabel(user.role)}
            </span>
          </div>

          {/* Department */}
          <div className="flex items-center gap-1.5 min-w-0">
            <Building2 className="h-3.5 w-3.5 shrink-0 text-primary/40" />
            {user.department ? (
              <span className="truncate text-xs font-medium text-foreground/80">{user.department}</span>
            ) : (
              <span className="text-xs text-muted-foreground/70">No department</span>
            )}
          </div>

          {/* Last active + manage */}
          <div className="flex items-center justify-end gap-2">
            <span className="hidden md:inline-flex items-center gap-1 text-[10px] text-muted-foreground whitespace-nowrap">
              <Clock className="h-3 w-3 opacity-60" />
              {lastLogin ?? "Never signed in"}
            </span>

            {!isCurrentUser ? (
              <>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/[0.06] text-primary/50 transition-all hover:bg-primary hover:text-primary-foreground hover:shadow-sm group-hover:bg-primary group-hover:text-primary-foreground"
                      disabled={roleUpdating || togglePending || resetting}
                    >
                      {roleUpdating || togglePending || resetting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <MoreHorizontal className="h-4 w-4" />
                      )}
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52 rounded-xl">
                    <DropdownMenuLabel className="text-xs text-muted-foreground">Change role</DropdownMenuLabel>
                    {Object.values(UserRole).map((r) => (
                      <DropdownMenuItem
                        key={r}
                        className="capitalize text-sm"
                        onClick={() => onRoleChange(r)}
                      >
                        <RoleIcon role={r} className="mr-2 h-4 w-4" />
                        {roleLabel(r)}
                        {user.role === r && <Check className="ml-auto h-4 w-4 text-primary" />}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className={active ? "text-rose-600 focus:text-rose-600" : "text-emerald-600 focus:text-emerald-600"}
                      onClick={onToggleActive}
                    >
                      {active ? (
                        <><UserX className="mr-2 h-4 w-4" /> Deactivate account</>
                      ) : (
                        <><UserCheck className="mr-2 h-4 w-4" /> Activate account</>
                      )}
                    </DropdownMenuItem>
                    <DropdownMenuItem className="text-primary focus:text-primary" onClick={() => setResetOpen(true)}>
                      <KeyRound className="mr-2 h-4 w-4" /> Reset password
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
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
                        className="rounded-xl"
                        onClick={() => {
                          onResetPassword();
                          setResetOpen(false);
                        }}
                      >
                        Reset password
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            ) : (
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/[0.06] text-primary/30">
                <User className="h-4 w-4" />
              </div>
            )}
          </div>
        </div>
      </article>
    </motion.div>
  );
}
