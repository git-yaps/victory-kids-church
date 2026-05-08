export function ageCategory(age: number): { label: string; tone: string } {
  if (age >= 3 && age <= 6) return { label: "Preschool", tone: "bg-accent text-accent-foreground" };
  if (age >= 7 && age <= 12) return { label: "Preteens", tone: "bg-primary text-primary-foreground" };
  return { label: "Other", tone: "bg-muted text-muted-foreground" };
}

export const SUNDAY_SERVICES = [
  "Sunday 9:00 AM",
  "Sunday 11:00 AM",
  "Sunday 1:00 PM",
  "Sunday 3:00 PM",
  "Sunday 5:00 PM",
];

export function downloadCSV(filename: string, rows: Record<string, any>[]) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const escape = (v: any) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [
    headers.join(","),
    ...rows.map(r => headers.map(h => escape(r[h])).join(",")),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
