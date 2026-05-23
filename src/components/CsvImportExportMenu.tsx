import { useRef, useState } from "react";
import { ChevronDown, FileDown, FileSpreadsheet, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { parseCSV } from "@/lib/utils-app";

type ImportResult = { inserted: number; failed: number; errors?: string[] };

/** Combined CSV import (file picker) and export callback in one menu. */
export function CsvImportExportMenu({
  sampleHeaders,
  onImport,
  onExport,
  disabled,
}: {
  sampleHeaders: string[];
  onImport: (rows: Record<string, string>[]) => Promise<ImportResult>;
  onExport: () => void;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const handleFile = async (file: File) => {
    setBusy(true);
    try {
      const text = await file.text();
      const rows = parseCSV(text);
      if (!rows.length) {
        toast.error("CSV is empty");
        return;
      }
      const missing = sampleHeaders.filter((h) => !(h in rows[0]));
      if (missing.length) {
        toast.error(`Missing columns: ${missing.join(", ")}`);
        return;
      }
      const r = await onImport(rows);
      if (r.failed)
        toast.warning(
          `Imported ${r.inserted}, ${r.failed} failed${r.errors?.length ? `: ${r.errors[0]}` : ""}`,
        );
      else toast.success(`Imported ${r.inserted} row${r.inserted === 1 ? "" : "s"}`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = "";
    }
  };

  return (
    <>
      <input
        ref={ref}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
        }}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={disabled || busy}
            aria-label="CSV import and export"
          >
            <FileSpreadsheet className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">CSV</span>
            <ChevronDown className="h-4 w-4 opacity-60 sm:ml-1" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem
            disabled={busy}
            onSelect={() => {
              queueMicrotask(() => ref.current?.click());
            }}
          >
            <Upload className="text-muted-foreground" />
            Import CSV…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              onExport();
            }}
          >
            <FileDown className="text-muted-foreground" />
            Export CSV
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
