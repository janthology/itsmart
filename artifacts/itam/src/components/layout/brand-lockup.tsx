import { cn } from "@/lib/utils";

/**
 * The single ITSMART brand lockup: DOST logo tile + "DOST Cagayan Valley"
 * eyebrow + IT/SMART wordmark (SMART in accent blue). Used in the app
 * header, login brand panel, loading splash, and error pages so the brand
 * looks identical everywhere.
 *
 * tone="dark" is for always-dark surfaces (login brand panel);
 * tone="auto" follows the light/dark theme (app header, splash).
 */
interface BrandLockupProps {
  tone?: "dark" | "auto";
  size?: "sm" | "md" | "lg";
  className?: string;
}

const SIZES = {
  sm: { tile: "h-10 w-10 rounded-lg", img: "h-7 w-7", eyebrow: "text-[9px]", title: "text-lg", gap: "gap-2.5" },
  md: { tile: "h-11 w-11 rounded-xl", img: "h-7 w-7", eyebrow: "text-[10px]", title: "text-xl", gap: "gap-3" },
  lg: { tile: "h-14 w-14 rounded-xl", img: "h-11 w-11", eyebrow: "text-[11px]", title: "text-4xl", gap: "gap-3.5" },
} as const;

export function BrandLockup({ tone = "auto", size = "md", className }: BrandLockupProps) {
  const s = SIZES[size];
  const dark = tone === "dark";
  return (
    <span className={cn("flex items-center", s.gap, className)}>
      <span
        className={cn(
          "flex shrink-0 items-center justify-center",
          s.tile,
          dark
            ? "bg-white/10 ring-1 ring-white/15"
            : "bg-gradient-to-br from-primary to-[hsl(207_38%_28%)] shadow-md shadow-primary/20 ring-1 ring-white/20"
        )}
      >
        <img src="/dostlogo.png" alt="DOST" className={cn("object-contain", s.img)} />
      </span>
      <span className="min-w-0 leading-none">
        <span
          className={cn(
            "block font-semibold uppercase tracking-[0.18em]",
            s.eyebrow,
            dark ? "text-white/70" : "text-muted-foreground"
          )}
        >
          DOST Cagayan Valley
        </span>
        <span
          className={cn(
            "mt-1 block font-display font-bold tracking-tight",
            s.title,
            dark ? "text-white" : "text-foreground"
          )}
        >
          IT<span className="text-accent">SMART</span>
        </span>
      </span>
    </span>
  );
}
