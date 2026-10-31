import type { ReactNode } from "react";

/**
 * Standard page header: eyebrow + display title + optional subtitle on the
 * left, page actions on the right. Every content page uses this so headers
 * look identical across the app; Dashboard's greeting banner and the
 * Reports hero are the two sanctioned hero variants.
 */
interface PageHeaderProps {
  eyebrow: string;
  title: ReactNode;
  subtitle?: ReactNode;
  children?: ReactNode;
}

export function PageHeader({ eyebrow, title, subtitle, children }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="app-page-eyebrow">{eyebrow}</p>
        <h1 className="app-page-title mt-1">{title}</h1>
        {subtitle ? (
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>
      {children ? (
        <div className="flex flex-wrap items-center gap-2">{children}</div>
      ) : null}
    </div>
  );
}
