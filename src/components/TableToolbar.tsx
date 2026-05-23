import * as React from "react";
import { cn } from "@/lib/utils";

type TableToolbarProps = {
  className?: string;
  /** Main row: search, filters, primary actions (usually right-aligned). */
  primary?: React.ReactNode;
  /** Optional second row for extra filters or grouped inputs. */
  secondary?: React.ReactNode;
  /** Bottom row: bulk actions, clear filters, metadata. */
  footer?: React.ReactNode;
};

export function TableToolbar({ className, primary, secondary, footer }: TableToolbarProps) {
  if (primary == null && secondary == null && footer == null) return null;
  return (
    <div className={cn("border-b bg-muted/40", className)}>
      {primary != null && (
        <div className="flex flex-wrap items-end gap-3 px-4 py-3">{primary}</div>
      )}
      {secondary != null && (
        <div className="flex flex-wrap items-end gap-3 border-t border-border/60 px-4 py-3">
          {secondary}
        </div>
      )}
      {footer != null && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border/60 px-4 py-2">
          {footer}
        </div>
      )}
    </div>
  );
}
