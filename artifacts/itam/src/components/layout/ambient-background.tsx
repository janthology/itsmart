import { memo } from "react";

// Memoized: static decorative layers with no props — never re-render.
export const AmbientBackground = memo(function AmbientBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,hsl(207_55%_62%/0.14),transparent_55%)] dark:opacity-40" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_100%_50%,hsl(207_38%_33%/0.08),transparent_50%)] dark:opacity-30" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_50%_40%_at_0%_80%,hsl(156_60%_45%/0.06),transparent_45%)] dark:opacity-25" />
      <div className="absolute -left-[20%] top-[10%] h-[420px] w-[420px] rounded-full bg-primary/[0.07] blur-[100px] animate-[float_18s_ease-in-out_infinite] dark:bg-primary/[0.12]" />
      <div className="absolute -right-[10%] top-[30%] h-[360px] w-[360px] rounded-full bg-accent/[0.12] blur-[90px] animate-[float_22s_ease-in-out_infinite_reverse] dark:bg-accent/[0.08]" />
      <div className="absolute bottom-[5%] left-[30%] h-[280px] w-[280px] rounded-full bg-emerald-400/[0.06] blur-[80px] animate-[float_20s_ease-in-out_infinite_2s] dark:bg-emerald-400/[0.04]" />
      <div
        className="absolute inset-0 opacity-[0.35] dark:opacity-[0.15]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, hsl(207 20% 70% / 0.12) 1px, transparent 0)",
          backgroundSize: "28px 28px",
        }}
      />
    </div>
  );
});
