/** Registered-on date (YYYY-MM-DD) from Postgres `timestamptz` for table lists. */
export function formatRegisteredDate(iso: string | null | undefined): string {
  if (iso == null || String(iso).trim() === "") return "—";
  return String(iso).trim().slice(0, 10);
}

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

// Minimal CSV parser supporting quoted fields, commas, and escaped quotes ("").
export function parseCSV(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let i = 0, inQ = false;
  const t = text.replace(/\r\n?/g, "\n");
  while (i < t.length) {
    const ch = t[i];
    if (inQ) {
      if (ch === '"') {
        if (t[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQ = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQ = true; i++; continue; }
    if (ch === ",") { cur.push(field); field = ""; i++; continue; }
    if (ch === "\n") { cur.push(field); rows.push(cur); cur = []; field = ""; i++; continue; }
    field += ch; i++;
  }
  if (field.length || cur.length) { cur.push(field); rows.push(cur); }
  const filtered = rows.filter(r => r.some(c => c.trim() !== ""));
  if (!filtered.length) return [];
  const headers = filtered[0].map(h => h.trim());
  return filtered.slice(1).map(r => {
    const o: Record<string, string> = {};
    headers.forEach((h, idx) => { o[h] = (r[idx] ?? "").trim(); });
    return o;
  });
}

export function ageFromBirthday(birthday: string): number {
  const b = new Date(birthday);
  if (isNaN(b.getTime())) return 0;
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return age;
}

/** Present age only when birthday is valid; otherwise null (no bogus 0-age). */
export function ageFromBirthdayOrNull(birthday: string | null | undefined): number | null {
  if (birthday == null || String(birthday).trim() === "") return null;
  const n = ageFromBirthday(String(birthday));
  const b = new Date(String(birthday));
  if (isNaN(b.getTime())) return null;
  return n;
}

/** Prefer birthday-derived age when set; otherwise use stored/manual `age` from the DB. */
export function displayChildAge(opts: {
  birthday: string | null | undefined;
  age: number | null | undefined;
}): number | null {
  const fromBday = ageFromBirthdayOrNull(opts.birthday);
  if (fromBday !== null) return fromBday;
  if (opts.age === null || opts.age === undefined) return null;
  const n = Number(opts.age);
  return Number.isFinite(n) ? n : null;
}

/** Used for child attendance rows when kids no longer have a saved service slot. */
export const DEFAULT_CHILD_ATTENDANCE_SERVICE = "General";

export function normalizeServiceScheduleKey(schedule: string): string {
  return String(schedule).trim().toLowerCase();
}

/**
 * Children's check-ins always use {@link DEFAULT_CHILD_ATTENDANCE_SERVICE}.
 * Serve team members must use a different service label so cohorts cannot share a schedule slot.
 */
export function isChildrenOnlyAttendanceServiceSchedule(schedule: string): boolean {
  return (
    normalizeServiceScheduleKey(schedule) === normalizeServiceScheduleKey(DEFAULT_CHILD_ATTENDANCE_SERVICE)
  );
}

