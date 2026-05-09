import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { parseCSV } from "@/lib/utils-app";

export function CSVImport({
  label = "Import CSV",
  sampleHeaders,
  onImport,
}: {
  label?: string;
  sampleHeaders: string[];
  onImport: (rows: Record<string, string>[]) => Promise<{ inserted: number; failed: number; errors?: string[] }>;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const handleFile = async (file: File) => {
    setBusy(true);
    try {
      const text = await file.text();
      const rows = parseCSV(text);
      if (!rows.length) { toast.error("CSV is empty"); return; }
      const missing = sampleHeaders.filter(h => !(h in rows[0]));
      if (missing.length) {
        toast.error(`Missing columns: ${missing.join(", ")}`);
        return;
      }
      const r = await onImport(rows);
      if (r.failed) toast.warning(`Imported ${r.inserted}, ${r.failed} failed${r.errors?.length ? `: ${r.errors[0]}` : ""}`);
      else toast.success(`Imported ${r.inserted} row${r.inserted === 1 ? "" : "s"}`);
    } catch (e: any) {
      toast.error(e?.message || "Import failed");
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
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
      />
      <Button
        variant="outline"
        disabled={busy}
        onClick={() => ref.current?.click()}
        title={`CSV columns: ${sampleHeaders.join(", ")}`}
      >
        <Upload className="h-4 w-4 mr-2" />{busy ? "Importing..." : label}
      </Button>
    </>
  );
}
