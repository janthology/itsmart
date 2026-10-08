import { ChevronRight } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { UserCardData } from "@/components/users/user-card";

function roleLabel(role: string) {
  return role.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
}

interface UserMemberStripProps {
  user: UserCardData;
  selected: boolean;
  isCurrentUser: boolean;
  onSelect: () => void;
}

export function UserMemberStrip({ user, selected, isCurrentUser, onSelect }: UserMemberStripProps) {
  const active = user.isActive !== false;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all",
        selected
          ? "bg-primary text-primary-foreground shadow-md shadow-primary/20"
          : "hover:bg-primary/[0.06]"
      )}
    >
      <div className="relative shrink-0">
        <Avatar className={cn("h-10 w-10", selected ? "ring-2 ring-white/30" : "ring-2 ring-primary/10")}>
          <AvatarFallback
            className={cn(
              "text-sm font-bold",
              selected ? "bg-white/20 text-white" : "bg-primary/10 text-primary"
            )}
          >
            {user.fullName.charAt(0)}
          </AvatarFallback>
        </Avatar>
        <span
          className={cn(
            "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2",
            selected ? "ring-primary" : "ring-card dark:ring-background",
            active ? "bg-emerald-400" : "bg-slate-400"
          )}
        />
      </div>
      <div className="min-w-0 flex-1">
        <p className={cn("truncate font-semibold text-sm", selected ? "text-white" : "text-foreground")}>
          {user.fullName}
          {isCurrentUser && (
            <span className={cn("ml-1.5 text-[10px] font-medium", selected ? "text-white/80" : "text-primary")}>
              (you)
            </span>
          )}
        </p>
        <p className={cn("truncate text-xs capitalize", selected ? "text-white/70" : "text-muted-foreground")}>
          {roleLabel(user.role)}
        </p>
      </div>
      <ChevronRight className={cn("h-4 w-4 shrink-0", selected ? "text-white/80" : "text-muted-foreground/40")} />
    </button>
  );
}
