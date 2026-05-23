import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { cn } from "@/lib/utils";

/** Default rows per page for list tables */
export const LIST_PAGE_SIZE = 25;

/** Build collapsed page list entries (1-based page numbers). */
function pageListEntries(currentPage: number, totalPages: number): (number | "ellipsis")[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const curr = currentPage + 1;
  const near = new Set(
    [1, totalPages, curr, curr - 1, curr + 1].filter(p => p >= 1 && p <= totalPages),
  );
  const sorted = [...near].sort((a, b) => a - b);
  const out: (number | "ellipsis")[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const v = sorted[i]!;
    if (i > 0 && v - sorted[i - 1]! > 1) out.push("ellipsis");
    out.push(v);
  }
  return out;
}

type TablePageNavigatorProps = {
  page: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (nextPage: number) => void;
  loading?: boolean;
  className?: string;
};

export function TablePageNavigator({
  page,
  pageSize,
  totalItems,
  onPageChange,
  loading = false,
  className,
}: TablePageNavigatorProps) {
  const totalPages =
    totalItems <= 0 ? 1 : Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(page, Math.max(0, totalPages - 1));
  const atFirst = safePage <= 0;
  const atLast = safePage >= totalPages - 1;

  const start = totalItems === 0 ? 0 : safePage * pageSize + 1;
  const end = Math.min(totalItems, safePage * pageSize + pageSize);

  const entries = pageListEntries(safePage, totalPages);

  return (
    <div
      className={cn(
        "flex flex-col-reverse gap-3 px-4 pt-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between",
        loading && "opacity-70 pointer-events-none",
        className,
      )}
      aria-busy={loading || undefined}
    >
      <p className="text-xs text-muted-foreground tabular-nums sm:text-sm">
        {totalItems === 0 ? (
          loading ? (
            <span className="text-muted-foreground">Updating count…</span>
          ) : (
            "No rows to show."
          )
        ) : (
          <>
            Showing <span className="font-medium text-foreground">{start}</span>–
            <span className="font-medium text-foreground">{end}</span>
            {" of "}
            <span className="font-medium text-foreground">{totalItems}</span>
          </>
        )}
      </p>
      <Pagination className="mx-0 justify-end sm:w-auto">
        <PaginationContent className="flex-wrap justify-end">
          <PaginationItem>
            <PaginationPrevious
              href="#"
              className={cn(atFirst && "pointer-events-none opacity-40")}
              aria-disabled={atFirst || undefined}
              onClick={(e) => {
                e.preventDefault();
                if (!atFirst) onPageChange(safePage - 1);
              }}
            />
          </PaginationItem>
          {totalPages > 1 &&
            entries.map((entry, idx) => {
              if (entry === "ellipsis") {
                const left = typeof entries[idx - 1] === "number" ? entries[idx - 1] : 0;
                const right = typeof entries[idx + 1] === "number" ? entries[idx + 1] : 0;
                return (
                  <PaginationItem key={`ellipsis-${left}-${right}`}>
                    <PaginationEllipsis />
                  </PaginationItem>
                );
              }
              return (
                <PaginationItem key={entry}>
                  <PaginationLink
                    href="#"
                    size="icon"
                    isActive={entry === safePage + 1}
                    onClick={(e) => {
                      e.preventDefault();
                      onPageChange(entry - 1);
                    }}
                  >
                    {entry}
                  </PaginationLink>
                </PaginationItem>
              );
            })}
          <PaginationItem>
            <PaginationNext
              href="#"
              className={cn(atLast || totalItems === 0 ? "pointer-events-none opacity-40" : "")}
              aria-disabled={atLast || totalItems === 0 || undefined}
              onClick={(e) => {
                e.preventDefault();
                if (!atLast && totalItems > 0) onPageChange(safePage + 1);
              }}
            />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  );
}
