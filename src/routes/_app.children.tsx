import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { TableToolbar } from "@/components/TableToolbar";
import { LIST_PAGE_SIZE, TablePageNavigator } from "@/components/TablePageNavigator";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import {
  Plus,
  QrCode,
  Pencil,
  Trash2,
  Download,
  Printer,
  Search,
  UserCheck,
  CircleCheck,
} from "lucide-react";
import { QRCodeImage } from "@/components/QRCodeImage";
import { CsvImportExportMenu } from "@/components/CsvImportExportMenu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import QRCode from "qrcode";
import {
  ageCategory,
  displayChildAge,
  downloadCSV,
  formatRegisteredDate,
  DEFAULT_CHILD_ATTENDANCE_SERVICE,
} from "@/lib/utils-app";
import { AttendanceStats } from "@/components/AttendanceStats";
import { enqueueAttendance } from "@/lib/offline-queue";
import { broadcastAttendanceChanged } from "@/lib/attendance-sync";
import { parseChildForm, type ParsedChildPayload } from "@/lib/child-form";

export const Route = createFileRoute("/_app/children")({
  component: ChildrenPage,
});

type Child = {
  id: string;
  full_name: string | null;
  parent_name: string | null;
  birthday: string | null;
  /** Legacy/manual value in DB when no birthday drives age yet. */
  age: number | null;
  created_at?: string | null;
};

function buildQR(c: Child) {
  return JSON.stringify({
    type: "child",
    id: c.id,
    full_name: c.full_name,
    birthday: c.birthday,
    parent_name: c.parent_name,
  });
}

function childDisplayName(c: Pick<Child, "full_name">) {
  const n = (c.full_name ?? "").trim();
  return n || "(Unnamed)";
}

type CategoryFilterValue = "" | "__unset__" | "Preschool" | "Preteens" | "Other";

/** Bucket for toolbar category filter; matches `ageCategory` labels. */
function resolvedCategoryBucket(c: Child): CategoryFilterValue {
  const age = displayChildAge({ birthday: c.birthday, age: c.age });
  if (age === null) return "__unset__";
  return ageCategory(age).label as "Preschool" | "Preteens" | "Other";
}

function badgeForAge(age: number | null) {
  if (age === null)
    return { label: "—", tone: "bg-muted text-muted-foreground", showCategory: false as const };
  return { ...ageCategory(age), showCategory: true as const };
}

type ChildCsvPayload = ParsedChildPayload & { age: number | null };

function normalizeImportRow(row: Record<string, string>): ChildCsvPayload | { error: string } {
  const full_name = row.full_name?.trim().slice(0, 100) || null;
  const parent_name = row.parent_name?.trim().slice(0, 100) || null;
  const b = row.birthday?.trim() || "";
  let birthday: string | null = null;
  if (b !== "") {
    const iso = b.slice(0, 10);
    const d = new Date(`${iso}T12:00:00`);
    if (isNaN(d.getTime())) return { error: "Invalid birthday" };
    birthday = iso;
  }
  let ageNum: number | null = null;
  const ageRaw = (row.age ?? "").trim();
  if (ageRaw !== "") {
    const n = Number.parseInt(ageRaw, 10);
    if (!Number.isFinite(n) || n < 0 || n > 120) return { error: "Invalid age" };
    ageNum = n;
  }
  return { full_name, parent_name, birthday, age: ageNum };
}

function csvRowForInsert(row: ChildCsvPayload) {
  const o: {
    full_name: string | null;
    parent_name: string | null;
    birthday: string | null;
    age?: number;
  } = { full_name: row.full_name, parent_name: row.parent_name, birthday: row.birthday };
  if (row.age !== null) o.age = row.age;
  return o;
}

function ChildrenPage() {
  const [items, setItems] = useState<Child[]>([]);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Child | null>(null);
  const [open, setOpen] = useState(false);
  const [qrFor, setQrFor] = useState<Child | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busyCheckIn, setBusyCheckIn] = useState<string | null>(null);
  /** Child ids with any attendance row on statsDate */
  const [checkedInChildIds, setCheckedInChildIds] = useState<Set<string>>(() => new Set());
  const [attendanceStatsRefresh, setAttendanceStatsRefresh] = useState(0);
  const [tablePage, setTablePage] = useState(0);
  const [statsDate, setStatsDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilterValue>("");
  const bumpAttendanceStats = () => {
    setAttendanceStatsRefresh((k) => k + 1);
    broadcastAttendanceChanged();
  };

  const load = async () => {
    const [childrenRes, attendanceRes] = await Promise.all([
      supabase.from("children").select("*").order("full_name"),
      supabase
        .from("attendance")
        .select("child_id")
        .eq("attendance_date", statsDate)
        .not("child_id", "is", null),
    ]);
    if (childrenRes.error) toast.error(childrenRes.error.message);
    else setItems((childrenRes.data as Child[]) ?? []);
    setSelected(new Set());
    if (attendanceRes.error) {
      setCheckedInChildIds(new Set());
    } else {
      const ids = new Set<string>();
      ((attendanceRes.data ?? []) as { child_id: string | null }[]).forEach((r) => {
        if (r.child_id != null) ids.add(r.child_id);
      });
      setCheckedInChildIds(ids);
    }
  };
  useEffect(() => {
    void load();
  }, [statsDate]);

  useEffect(() => {
    setTablePage(0);
  }, [search, categoryFilter]);

  const filtered = useMemo(
    () =>
      items.filter((c) => {
        const name = (c.full_name ?? "").toLowerCase();
        const parent = (c.parent_name ?? "").toLowerCase();
        const q = search.toLowerCase();
        const textOk = !search || name.includes(q) || parent.includes(q);
        const catOk = !categoryFilter || resolvedCategoryBucket(c) === categoryFilter;
        return textOk && catOk;
      }),
    [items, search, categoryFilter],
  );

  useEffect(() => {
    const last = Math.max(0, Math.ceil(filtered.length / LIST_PAGE_SIZE) - 1);
    if (tablePage > last) setTablePage(last);
  }, [filtered.length, tablePage]);

  const pageRows = useMemo(
    () => filtered.slice(tablePage * LIST_PAGE_SIZE, tablePage * LIST_PAGE_SIZE + LIST_PAGE_SIZE),
    [filtered, tablePage],
  );

  const allSelected = filtered.length > 0 && filtered.every((c) => selected.has(c.id));
  const toggleAll = () => {
    const next = new Set(selected);
    if (allSelected) filtered.forEach((c) => next.delete(c.id));
    else filtered.forEach((c) => next.add(c.id));
    setSelected(next);
  };
  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const handleSubmit = async (form: HTMLFormElement) => {
    const parsed = parseChildForm(form);
    if ("error" in parsed) return toast.error(parsed.error);
    const payload = parsed;

    const hasAnything =
      payload.full_name != null || payload.parent_name != null || payload.birthday != null;
    if (!hasAnything) return toast.info("Nothing to save — fill at least one field.");

    if (editing) {
      const { error } = await supabase.from("children").update(payload).eq("id", editing.id);
      if (error) return toast.error(error.message);
      toast.success("Child updated");
    } else {
      const { error } = await supabase.from("children").insert(payload);
      if (error) return toast.error(error.message);
      toast.success("Child registered");
    }
    setOpen(false);
    setEditing(null);
    load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this child? This also removes their attendance.")) return;
    const { error } = await supabase.from("children").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Deleted");
    load();
  };

  const handleBatchDelete = async () => {
    if (!selected.size) return;
    if (!confirm(`Delete ${selected.size} child(ren)? This also removes their attendance.`)) return;
    const ids = Array.from(selected);
    const { error } = await supabase.from("children").delete().in("id", ids);
    if (error) return toast.error(error.message);
    toast.success(`Deleted ${ids.length}`);
    load();
  };

  const exportCSV = () => {
    if (!filtered.length) return toast.info("Nothing to export");
    downloadCSV(
      `children_${new Date().toISOString().slice(0, 10)}.csv`,
      filtered.map((c) => {
        const shown = displayChildAge({ birthday: c.birthday, age: c.age });
        const cat = badgeForAge(shown);
        return {
          full_name: c.full_name ?? "",
          birthday: c.birthday ?? "",
          stored_age: c.age ?? "",
          computed_age_now: shown ?? "",
          category: cat.showCategory && shown !== null ? ageCategory(shown).label : "",
          parent_name: c.parent_name ?? "",
          registered: formatRegisteredDate(c.created_at),
        };
      }),
    );
  };

  const importCSV = async (rows: Record<string, string>[]) => {
    const errors: string[] = [];
    const valid: ChildCsvPayload[] = [];
    rows.forEach((r, i) => {
      const row = normalizeImportRow(r);
      if ("error" in row) errors.push(`Row ${i + 2}: ${row.error}`);
      else {
        const has =
          row.full_name != null ||
          row.parent_name != null ||
          row.birthday != null ||
          row.age !== null;
        if (!has) {
          errors.push(`Row ${i + 2}: At least one of full_name, parent_name, birthday, or age`);
        } else valid.push(row);
      }
    });
    if (!valid.length) return { inserted: 0, failed: rows.length, errors };
    const { error } = await supabase.from("children").insert(valid.map(csvRowForInsert));
    if (error) return { inserted: 0, failed: rows.length, errors: [error.message] };
    load();
    return { inserted: valid.length, failed: errors.length, errors };
  };

  const downloadQR = async (c: Child) => {
    const slug = childDisplayName(c).replace(/\s+/g, "_");
    const url = await QRCode.toDataURL(buildQR(c), { width: 600, margin: 2 });
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug}_QR.png`;
    a.click();
  };

  const printQR = async (c: Child) => {
    const url = await QRCode.toDataURL(buildQR(c), { width: 600, margin: 2 });
    const w = window.open("", "_blank");
    if (!w) return;
    const age = displayChildAge({ birthday: c.birthday, age: c.age });
    const cat = badgeForAge(age);
    const ageLine =
      age === null
        ? "Age not set"
        : `Age ${age}${cat.showCategory ? ` (${ageCategory(age).label})` : ""}`;
    const titleEsc = `${childDisplayName(c)}`.replace(/</g, "");
    const nameHtml = `${childDisplayName(c)}`;
    const parentDisp = (c.parent_name ?? "—").replace(/</g, "");
    w.document.write(`
      <html><head><title>QR Badge - ${titleEsc}</title>
      <style>body{font-family:DM Sans,sans-serif;text-align:center;padding:24px}
      .card{border:2px solid #14498B;border-radius:16px;padding:24px;display:inline-block;max-width:340px}
      h1{color:#14498B;margin:8px 0;font-size:22px} p{margin:4px 0;color:#444}
      img{width:280px;height:280px}</style></head>
      <body><div class="card">
        <h1>Victory Church</h1>
        <img src="${url}" />
        <h2 style="margin:8px 0">${nameHtml}</h2>
        <p>${ageLine}${c.birthday ? `<br>Birthday: ${String(c.birthday).slice(0, 10)}` : ""}</p>
        <p>Parent: ${parentDisp}</p>
      </div><script>window.onload=()=>window.print()</script></body></html>`);
    w.document.close();
  };

  const manualCheckIn = async (c: Child) => {
    setBusyCheckIn(c.id);
    const label = childDisplayName(c);
    const payload = {
      child_id: c.id,
      service_schedule: DEFAULT_CHILD_ATTENDANCE_SERVICE,
      attendance_date: statsDate,
      attendance_time: new Date().toTimeString().slice(0, 8),
      method: "manual" as const,
    };
    if (!navigator.onLine) {
      enqueueAttendance(payload);
      toast.success(`${label} — saved offline`);
      setBusyCheckIn(null);
      return;
    }
    const { error } = await supabase.from("attendance").insert(payload);
    setBusyCheckIn(null);
    if (error) {
      if (
        error.message.toLowerCase().includes("duplicate") ||
        (error as { code?: string }).code === "23505"
      ) {
        void load();
        toast.info(`${label} is already checked in for this date & service`);
      } else toast.error(error.message);
    } else {
      void load();
      toast.success(`${label} checked in`);
      bumpAttendanceStats();
    }
  };

  const removeCheckInToday = async (c: Child) => {
    if (!navigator.onLine) {
      toast.error("Connect to the internet to remove a check-in.");
      return;
    }
    setBusyCheckIn(c.id);
    const label = childDisplayName(c);
    const { data, error } = await supabase
      .from("attendance")
      .delete()
      .eq("child_id", c.id)
      .eq("attendance_date", statsDate)
      .select("id");
    setBusyCheckIn(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (!data?.length) {
      toast.info("No check-in for that date — refreshing.");
      void load();
      bumpAttendanceStats();
      return;
    }
    void load();
    toast.success(`${label} removed from attendance (${statsDate})`);
    bumpAttendanceStats();
  };

  const toggleAttendanceToday = async (c: Child) => {
    if (checkedInChildIds.has(c.id)) await removeCheckInToday(c);
    else await manualCheckIn(c);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Children</h1>
        <p className="text-muted-foreground mt-1">Register children and generate QR badges.</p>
      </div>

      <AttendanceStats
        filter="child"
        title="Today's Children Check-ins"
        refreshKey={attendanceStatsRefresh}
        statsDate={statsDate}
        onStatsDateChange={setStatsDate}
      />

      <Card className="overflow-hidden py-0 gap-0 shadow-sm">
        <TableToolbar
          primary={
            <>
              <div className="flex w-full flex-1 flex-wrap items-center gap-3">
                <div className="relative min-w-[200px] max-w-md flex-1">
                  <div className="relative">
                    <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none z-10" />
                    <Input
                      placeholder="Search by name or parent…"
                      className="pl-9"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      aria-label="Search children"
                    />
                  </div>
                </div>
                <div className="w-full min-w-[140px] sm:w-auto sm:min-w-[160px]">
                  <Input
                    type="date"
                    value={statsDate}
                    onChange={(e) => setStatsDate(e.target.value)}
                    aria-label="Check-in stats date"
                  />
                </div>
                <div className="w-full min-w-[160px] sm:w-48">
                  <Select
                    value={categoryFilter || "__all__"}
                    onValueChange={(v) =>
                      setCategoryFilter(v === "__all__" ? "" : (v as CategoryFilterValue))
                    }
                  >
                    <SelectTrigger aria-label="Filter by age category">
                      <SelectValue placeholder="All categories" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">All categories</SelectItem>
                      <SelectItem value="Preschool">Preschool</SelectItem>
                      <SelectItem value="Preteens">Preteens</SelectItem>
                      <SelectItem value="Other">Other</SelectItem>
                      <SelectItem value="__unset__">No age set</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto sm:justify-end">
                <CsvImportExportMenu
                  sampleHeaders={["full_name", "birthday", "parent_name", "age"]}
                  onImport={importCSV}
                  onExport={exportCSV}
                />
                <Dialog
                  open={open}
                  onOpenChange={(v) => {
                    setOpen(v);
                    if (!v) setEditing(null);
                  }}
                >
                  <DialogTrigger asChild>
                    <Button>
                      <Plus className="h-4 w-4 sm:mr-2" />
                      <span className="hidden sm:inline">Register Child</span>
                      <span className="sm:hidden">Add</span>
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>{editing ? "Edit Child" : "Register Child"}</DialogTitle>
                    </DialogHeader>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void handleSubmit(e.currentTarget);
                      }}
                      className="space-y-4"
                    >
                      <div className="space-y-2">
                        <Label htmlFor="child-full_name">Full name</Label>
                        <Input
                          id="child-full_name"
                          name="full_name"
                          defaultValue={editing?.full_name ?? undefined}
                          placeholder="Optional"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="child-birthday">Birthday</Label>
                        <Input
                          id="child-birthday"
                          name="birthday"
                          type="date"
                          defaultValue={editing?.birthday ?? undefined}
                        />
                        <p className="text-xs text-muted-foreground">
                          With a birthday, age follows the calendar. Without one, legacy rows keep
                          using the numeric age saved in the database.
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="child-parent_name">Parent name</Label>
                        <Input
                          id="child-parent_name"
                          name="parent_name"
                          defaultValue={editing?.parent_name ?? undefined}
                          placeholder="Optional"
                        />
                      </div>
                      <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                          Cancel
                        </Button>
                        <Button type="submit">{editing ? "Save" : "Register"}</Button>
                      </DialogFooter>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>
            </>
          }
          footer={
            selected.size > 0 ? (
              <Button variant="destructive" onClick={handleBatchDelete}>
                <Trash2 className="h-4 w-4 mr-2" />
                Delete Selected ({selected.size})
              </Button>
            ) : null
          }
        />
        <CardContent className="p-0 pb-6 pt-0">
          <div className="overflow-x-auto px-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 text-center tabular-nums text-muted-foreground">
                    #
                  </TableHead>
                  <TableHead className="w-10">
                    <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
                  </TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Birthday</TableHead>
                  <TableHead>Age</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Parent</TableHead>
                  <TableHead className="whitespace-nowrap">Registered</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-muted-foreground py-12">
                      {items.length === 0 ? "No children registered yet." : "No matches."}
                    </TableCell>
                  </TableRow>
                )}
                {pageRows.map((c, rowIdx) => {
                  const rowNum = tablePage * LIST_PAGE_SIZE + rowIdx + 1;
                  const age = displayChildAge({ birthday: c.birthday, age: c.age });
                  const badge = badgeForAge(age);
                  const isCheckedInToday = checkedInChildIds.has(c.id);
                  return (
                    <TableRow key={c.id} data-state={selected.has(c.id) ? "selected" : undefined}>
                      <TableCell
                        className="w-10 text-center tabular-nums text-muted-foreground text-xs"
                        title={c.id}
                      >
                        {rowNum}
                      </TableCell>
                      <TableCell>
                        <Checkbox
                          checked={selected.has(c.id)}
                          onCheckedChange={() => toggleOne(c.id)}
                        />
                      </TableCell>
                      <TableCell className="font-medium">{childDisplayName(c)}</TableCell>
                      <TableCell>{c.birthday ?? "—"}</TableCell>
                      <TableCell>{age ?? "—"}</TableCell>
                      <TableCell>
                        <Badge className={badge.tone} variant="secondary">
                          {badge.label}
                        </Badge>
                      </TableCell>
                      <TableCell>{c.parent_name ?? "—"}</TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">
                        {formatRegisteredDate(c.created_at)}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <Button
                          size="sm"
                          variant="ghost"
                          type="button"
                          aria-pressed={isCheckedInToday}
                          title={
                            isCheckedInToday
                              ? "Checked in for this date — click to remove"
                              : "Not checked in — click to check in"
                          }
                          disabled={busyCheckIn === c.id}
                          onClick={() => toggleAttendanceToday(c)}
                          className={
                            isCheckedInToday
                              ? "text-green-600 hover:bg-green-50 hover:text-green-700 dark:text-green-500 dark:hover:bg-green-950/40"
                              : undefined
                          }
                        >
                          {isCheckedInToday ? (
                            <CircleCheck className="h-4 w-4" strokeWidth={2.75} aria-hidden />
                          ) : (
                            <UserCheck className="h-4 w-4" aria-hidden />
                          )}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setQrFor(c)}>
                          <QrCode className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditing(c);
                            setOpen(true);
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => handleDelete(c.id)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <TablePageNavigator
            page={tablePage}
            pageSize={LIST_PAGE_SIZE}
            totalItems={filtered.length}
            onPageChange={setTablePage}
          />
        </CardContent>
      </Card>

      <Dialog open={!!qrFor} onOpenChange={(v) => !v && setQrFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{qrFor ? childDisplayName(qrFor) : ""} — QR Badge</DialogTitle>
          </DialogHeader>
          {qrFor && (
            <div className="space-y-4">
              <div className="flex justify-center">
                <QRCodeImage value={buildQR(qrFor)} size={260} />
              </div>
              <div className="text-center text-sm text-muted-foreground">
                {(() => {
                  const a = displayChildAge({ birthday: qrFor.birthday, age: qrFor.age });
                  const b = badgeForAge(a);
                  return (
                    <div>
                      {a !== null ? `Age ${a}` : "Age —"}
                      {b.showCategory && a !== null ? ` · ${ageCategory(a).label}` : ""}
                      {qrFor.birthday ? ` · Born ${qrFor.birthday}` : ""}
                    </div>
                  );
                })()}
                <div>Parent: {qrFor.parent_name ?? "—"}</div>
              </div>
              <div className="flex gap-2 justify-center">
                <Button variant="outline" onClick={() => downloadQR(qrFor)}>
                  <Download className="h-4 w-4 mr-2" />
                  Download
                </Button>
                <Button onClick={() => printQR(qrFor)}>
                  <Printer className="h-4 w-4 mr-2" />
                  Print
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
