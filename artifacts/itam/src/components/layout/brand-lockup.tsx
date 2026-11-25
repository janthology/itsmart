import { cn } from "@/lib/utils";

/**
 * The single ITSMART brand lockup: DOST logo + "DOST Cagayan Valley"
 * eyebrow + IT/SMART wordmark (SMART in accent blue). Used in the app
 * header, login brand panel, loading splash, and error pages so the brand
 * looks identical everywhere. The logo is shown without a background tile.
 *
 * tone="dark" is for always-dark surfaces (login brand panel);
 * tone="auto" follows the light/dark theme (app header, splash).
 */
interface BrandLockupProps {
  tone?: "dark" | "auto";
  size?: "sm" | "md" | "lg";
  className?: string;
}

// md is the app header (floating-nav). Its wordmark is larger and sits closer
// to the logo and the eyebrow so the lockup reads as one unit.
const SIZES = {
  sm: { img: "h-8 w-8", eyebrow: "text-[9px]", title: "text-lg", gap: "gap-2.5", stack: "mt-1" },
  md: { img: "h-10 w-10", eyebrow: "text-[10px]", title: "text-2xl", gap: "gap-2", stack: "-mt-1.5" },
  lg: { img: "h-16 w-16", eyebrow: "text-[11px]", title: "text-4xl", gap: "gap-3.5", stack: "mt-1" },
} as const;

export function BrandLockup({ tone = "auto", size = "md", className }: BrandLockupProps) {
  const s = SIZES[size];
  const dark = tone === "dark";
  return (
    <span className={cn("flex items-center", s.gap, className)}>
      {/* Light mode: soft shadow lifts the logo off light backgrounds.
          Dark mode (and the always-dark login panel): white halo outlines the
          black parts of the logo so the shape stays visible. */}
      <img
        src="/dostlogo.png"
        alt="DOST"
        className={cn(
          "shrink-0 object-contain",
          s.img,
          dark
            ? "[filter:drop-shadow(0_0_1px_rgba(255,255,255,0.9))_drop-shadow(0_0_6px_rgba(255,255,255,0.35))]"
            : "[filter:drop-shadow(0_2px_4px_rgba(15,23,42,0.3))] dark:[filter:drop-shadow(0_0_1px_rgba(255,255,255,0.9))_drop-shadow(0_0_6px_rgba(255,255,255,0.35))]"
        )}
      />
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
            "block font-display font-bold tracking-tight",
            s.stack,
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
