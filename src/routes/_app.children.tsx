import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TableToolbar } from "@/components/TableToolbar";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Plus, QrCode, Pencil, Trash2, Download, Printer, Search, FileDown, UserCheck, CircleCheck } from "lucide-react";
import { QRCodeImage } from "@/components/QRCodeImage";
import { CSVImport } from "@/components/CSVImport";
import QRCode from "qrcode";
import { z } from "zod";
import { ageCategory, SUNDAY_SERVICES, downloadCSV } from "@/lib/utils-app";
import { AttendanceStats } from "@/components/AttendanceStats";
import { enqueueAttendance } from "@/lib/offline-queue";
import { broadcastAttendanceChanged } from "@/lib/attendance-sync";

export const Route = createFileRoute("/_app/children")({
  component: ChildrenPage,
});

type Child = {
  id: string;
  full_name: string;
  age: number;
  parent_name: string;
  service_schedule: string;
};

const schema = z.object({
  full_name: z.string().trim().min(1, "Name required").max(100),
  age: z.coerce.number().int().min(0).max(18),
  parent_name: z.string().trim().min(1, "Parent name required").max(100),
  service_schedule: z.string().trim().min(1, "Service required").max(100),
});

const SERVICES = [...SUNDAY_SERVICES, "Friday 6:00 PM"];

function buildQR(c: Child) {
  return JSON.stringify({
    type: "child",
    id: c.id, full_name: c.full_name, age: c.age,
    parent_name: c.parent_name, service_schedule: c.service_schedule,
  });
}

function ChildrenPage() {
  const [items, setItems] = useState<Child[]>([]);
  const [search, setSearch] = useState("");
  const [serviceFilter, setServiceFilter] = useState("");
  const [editing, setEditing] = useState<Child | null>(null);
  const [open, setOpen] = useState(false);
  const [qrFor, setQrFor] = useState<Child | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busyCheckIn, setBusyCheckIn] = useState<string | null>(null);
  const [checkedInTodayIds, setCheckedInTodayIds] = useState<Set<string>>(new Set());
  const [attendanceStatsRefresh, setAttendanceStatsRefresh] = useState(0);
  const bumpAttendanceStats = () => {
    setAttendanceStatsRefresh(k => k + 1);
    broadcastAttendanceChanged();
  };

  const load = async () => {
    const today = new Date().toISOString().slice(0, 10);
    const [childrenRes, attendanceRes] = await Promise.all([
      supabase.from("children").select("*").order("full_name"),
      supabase
        .from("attendance")
        .select("child_id")
        .eq("attendance_date", today)
        .not("child_id", "is", null),
    ]);
    if (childrenRes.error) toast.error(childrenRes.error.message);
    else setItems((childrenRes.data as Child[]) ?? []);
    setSelected(new Set());
    if (!attendanceRes.error && attendanceRes.data) {
      setCheckedInTodayIds(
        new Set(
          (attendanceRes.data as { child_id: string | null }[])
            .map(r => r.child_id)
            .filter((id): id is string => id != null),
        ),
      );
    }
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => items.filter(c => {
    const matchText =
      !search ||
      c.full_name.toLowerCase().includes(search.toLowerCase()) ||
      c.parent_name.toLowerCase().includes(search.toLowerCase());
    const matchService = !serviceFilter || c.service_schedule === serviceFilter;
    return matchText && matchService;
  }), [items, search, serviceFilter]);

  const allSelected = filtered.length > 0 && filtered.every(c => selected.has(c.id));
  const toggleAll = () => {
    const next = new Set(selected);
    if (allSelected) filtered.forEach(c => next.delete(c.id));
    else filtered.forEach(c => next.add(c.id));
    setSelected(next);
  };
  const toggleOne = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const handleSubmit = async (form: HTMLFormElement) => {
    const fd = new FormData(form);
    const parsed = schema.safeParse(Object.fromEntries(fd));
    if (!parsed.success) return toast.error(parsed.error.issues[0].message);
    if (editing) {
      const { error } = await supabase.from("children").update(parsed.data).eq("id", editing.id);
      if (error) return toast.error(error.message);
      toast.success("Child updated");
    } else {
      const { error } = await supabase.from("children").insert(parsed.data);
      if (error) return toast.error(error.message);
      toast.success("Child registered");
    }
    setOpen(false); setEditing(null); load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this child? This also removes their attendance.")) return;
    const { error } = await supabase.from("children").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Deleted"); load();
  };

  const handleBatchDelete = async () => {
    if (!selected.size) return;
    if (!confirm(`Delete ${selected.size} child(ren)? This also removes their attendance.`)) return;
    const ids = Array.from(selected);
    const { error } = await supabase.from("children").delete().in("id", ids);
    if (error) return toast.error(error.message);
    toast.success(`Deleted ${ids.length}`); load();
  };

  const exportCSV = () => {
    if (!filtered.length) return toast.info("Nothing to export");
    downloadCSV(`children_${new Date().toISOString().slice(0,10)}.csv`,
      filtered.map(c => ({
        full_name: c.full_name, age: c.age, category: ageCategory(c.age).label,
        parent_name: c.parent_name, service_schedule: c.service_schedule,
      })));
  };

  const importCSV = async (rows: Record<string, string>[]) => {
    const errors: string[] = [];
    const valid: any[] = [];
    rows.forEach((r, i) => {
      const parsed = schema.safeParse({
        full_name: r.full_name,
        age: r.age,
        parent_name: r.parent_name,
        service_schedule: r.service_schedule,
      });
      if (!parsed.success) errors.push(`Row ${i + 2}: ${parsed.error.issues[0].message}`);
      else valid.push(parsed.data);
    });
    if (!valid.length) return { inserted: 0, failed: rows.length, errors };
    const { error } = await supabase.from("children").insert(valid);
    if (error) return { inserted: 0, failed: rows.length, errors: [error.message] };
    load();
    return { inserted: valid.length, failed: errors.length, errors };
  };

  const downloadQR = async (c: Child) => {
    const url = await QRCode.toDataURL(buildQR(c), { width: 600, margin: 2 });
    const a = document.createElement("a");
    a.href = url; a.download = `${c.full_name.replace(/\s+/g, "_")}_QR.png`;
    a.click();
  };

  const printQR = async (c: Child) => {
    const url = await QRCode.toDataURL(buildQR(c), { width: 600, margin: 2 });
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`
      <html><head><title>QR Badge - ${c.full_name}</title>
      <style>body{font-family:DM Sans,sans-serif;text-align:center;padding:24px}
      .card{border:2px solid #14498B;border-radius:16px;padding:24px;display:inline-block;max-width:340px}
      h1{color:#14498B;margin:8px 0;font-size:22px} p{margin:4px 0;color:#444}
      img{width:280px;height:280px}</style></head>
      <body><div class="card">
        <h1>Victory Kids Church</h1>
        <img src="${url}" />
        <h2 style="margin:8px 0">${c.full_name}</h2>
        <p>Age: ${c.age} (${ageCategory(c.age).label})</p><p>Parent: ${c.parent_name}</p><p>${c.service_schedule}</p>
      </div><script>window.onload=()=>window.print()</script></body></html>`);
    w.document.close();
  };

  const manualCheckIn = async (c: Child) => {
    setBusyCheckIn(c.id);
    const payload = {
      child_id: c.id,
      service_schedule: c.service_schedule,
      attendance_date: new Date().toISOString().slice(0, 10),
      attendance_time: new Date().toTimeString().slice(0, 8),
      method: "manual" as const,
    };
    if (!navigator.onLine) {
      enqueueAttendance(payload);
      toast.success(`${c.full_name} — saved offline`);
      setBusyCheckIn(null);
      return;
    }
    const { error } = await supabase.from("attendance").insert(payload);
    setBusyCheckIn(null);
    if (error) {
      if (error.message.toLowerCase().includes("duplicate") || (error as { code?: string }).code === "23505") {
        setCheckedInTodayIds(prev => new Set(prev).add(c.id));
        toast.info(`${c.full_name} is already checked in today`);
      } else toast.error(error.message);
    } else {
      setCheckedInTodayIds(prev => new Set(prev).add(c.id));
      toast.success(`${c.full_name} checked in`);
      bumpAttendanceStats();
    }
  };

  const removeCheckInToday = async (c: Child) => {
    if (!navigator.onLine) {
      toast.error("Connect to the internet to remove a check-in.");
      return;
    }
    setBusyCheckIn(c.id);
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from("attendance")
      .delete()
      .eq("child_id", c.id)
      .eq("attendance_date", today)
      .select("id");
    setBusyCheckIn(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (!data?.length) {
      toast.info("No attendance found for today — refreshing.");
      load();
      bumpAttendanceStats();
      return;
    }
    setCheckedInTodayIds(prev => {
      const next = new Set(prev);
      next.delete(c.id);
      return next;
    });
    toast.success(`${c.full_name} removed from today's attendance`);
    bumpAttendanceStats();
  };

  const toggleAttendanceToday = async (c: Child) => {
    if (checkedInTodayIds.has(c.id)) await removeCheckInToday(c);
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
      />

      <Card className="overflow-hidden py-0 gap-0 shadow-sm">
        <TableToolbar
          primary={
            <>
              <div className="relative min-w-[200px] max-w-md flex-1">
                <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none z-10" />
                <Input
                  placeholder="Search by name or parent…"
                  className="pl-9"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  aria-label="Search children"
                />
              </div>
              <div className="w-full min-w-[160px] sm:w-52 space-y-1.5">
                <Label className="text-xs text-muted-foreground">Service</Label>
                <Select
                  value={serviceFilter || "__all__"}
                  onValueChange={v => setServiceFilter(v === "__all__" ? "" : v)}
                >
                  <SelectTrigger aria-label="Filter by service">
                    <SelectValue placeholder="All services" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All services</SelectItem>
                    {SERVICES.map(s => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
                <CSVImport
                  sampleHeaders={["full_name", "age", "parent_name", "service_schedule"]}
                  onImport={importCSV}
                />
                <Button variant="outline" size="sm" onClick={exportCSV}>
                  <FileDown className="h-4 w-4 sm:mr-2" />
                  <span className="hidden sm:inline">Export CSV</span>
                </Button>
                <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditing(null); }}>
                  <DialogTrigger asChild>
                    <Button size="sm">
                      <Plus className="h-4 w-4 sm:mr-2" />
                      <span className="hidden sm:inline">Register Child</span>
                      <span className="sm:hidden">Add</span>
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader><DialogTitle>{editing ? "Edit Child" : "Register Child"}</DialogTitle></DialogHeader>
                    <form onSubmit={(e) => { e.preventDefault(); handleSubmit(e.currentTarget); }} className="space-y-4">
                      <div className="space-y-2"><Label>Full Name</Label>
                        <Input name="full_name" required defaultValue={editing?.full_name} /></div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2"><Label>Age</Label>
                          <Input name="age" type="number" min={0} max={18} required defaultValue={editing?.age} /></div>
                        <div className="space-y-2"><Label>Service Schedule</Label>
                          <Input name="service_schedule" list="services" required defaultValue={editing?.service_schedule} placeholder="Pick or type" />
                          <datalist id="services">{SERVICES.map(s => <option key={s} value={s} />)}</datalist></div>
                      </div>
                      <div className="space-y-2"><Label>Parent's Name</Label>
                        <Input name="parent_name" required defaultValue={editing?.parent_name} /></div>
                      <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
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
              <Button variant="destructive" size="sm" onClick={handleBatchDelete}>
                <Trash2 className="h-4 w-4 mr-2" />Delete Selected ({selected.size})
              </Button>
            ) : null
          }
        />
        <CardContent className="p-0 pb-6 pt-0">
          <div className="overflow-x-auto px-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10"><Checkbox checked={allSelected} onCheckedChange={toggleAll} /></TableHead>
                <TableHead>Name</TableHead><TableHead>Age</TableHead><TableHead>Category</TableHead>
                <TableHead>Parent</TableHead><TableHead>Service</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-12">
                  {items.length === 0 ? "No children registered yet." : "No matches."}
                </TableCell></TableRow>
              )}
              {filtered.map(c => {
                const cat = ageCategory(c.age);
                const isCheckedInToday = checkedInTodayIds.has(c.id);
                return (
                  <TableRow key={c.id} data-state={selected.has(c.id) ? "selected" : undefined}>
                    <TableCell><Checkbox checked={selected.has(c.id)} onCheckedChange={() => toggleOne(c.id)} /></TableCell>
                    <TableCell className="font-medium">{c.full_name}</TableCell>
                    <TableCell>{c.age}</TableCell>
                    <TableCell><Badge className={cat.tone} variant="secondary">{cat.label}</Badge></TableCell>
                    <TableCell>{c.parent_name}</TableCell>
                    <TableCell>{c.service_schedule}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button
                        size="sm"
                        variant="ghost"
                        type="button"
                        aria-pressed={isCheckedInToday}
                        title={
                          isCheckedInToday
                            ? "Checked in today — click to remove"
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
                      <Button size="sm" variant="ghost" onClick={() => setQrFor(c)}><QrCode className="h-4 w-4" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => { setEditing(c); setOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => handleDelete(c.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!qrFor} onOpenChange={(v) => !v && setQrFor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{qrFor?.full_name} — QR Badge</DialogTitle></DialogHeader>
          {qrFor && (
            <div className="space-y-4">
              <div className="flex justify-center"><QRCodeImage value={buildQR(qrFor)} size={260} /></div>
              <div className="text-center text-sm text-muted-foreground">
                <div>Age {qrFor.age} · {ageCategory(qrFor.age).label} · {qrFor.service_schedule}</div>
                <div>Parent: {qrFor.parent_name}</div>
              </div>
              <div className="flex gap-2 justify-center">
                <Button variant="outline" onClick={() => downloadQR(qrFor)}><Download className="h-4 w-4 mr-2" />Download</Button>
                <Button onClick={() => printQR(qrFor)}><Printer className="h-4 w-4 mr-2" />Print</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
