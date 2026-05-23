import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { UserPlus, FileDown, Trash2 } from "lucide-react";
import { downloadCSV, ageCategory, ageFromBirthday } from "@/lib/utils-app";
import { AttendanceStats } from "@/components/AttendanceStats";
import { ATTENDANCE_CHANGED_EVENT } from "@/lib/attendance-sync";
import { TableToolbar } from "@/components/TableToolbar";

export const Route = createFileRoute("/_app/records")({
  component: RecordsPage,
});

type Row = {
  id: string;
  attendance_date: string;
  attendance_time: string;
  service_schedule: string;
  method: string;
  children: { full_name: string; parent_name: string; age: number } | null;
  serve_team: { full_name: string; birthday: string } | null;
};

const PAGE = 25;

function RecordsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [child, setChild] = useState("");
  const [parent, setParent] = useState("");
  const [service, setService] = useState("");
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [statsRefreshKey, setStatsRefreshKey] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase.from("attendance")
      .select("id,attendance_date,attendance_time,service_schedule,method,children(full_name,parent_name,age),serve_team(full_name,birthday)")
      .order("attendance_date", { ascending: false })
      .order("attendance_time", { ascending: false })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (date) q = q.eq("attendance_date", date);
    if (service) q = q.ilike("service_schedule", `%${service}%`);
    const { data, error } = await q;
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    setRows((data as any) ?? []);
    setSelected(new Set());
  }, [date, service, page]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const onSync = () => {
      setStatsRefreshKey(k => k + 1);
      void load();
    };
    window.addEventListener(ATTENDANCE_CHANGED_EVENT, onSync);
    return () => window.removeEventListener(ATTENDANCE_CHANGED_EVENT, onSync);
  }, [load]);

  const filtered = useMemo(() => rows.filter(r => {
    const name = r.children?.full_name ?? r.serve_team?.full_name ?? "";
    const par = r.children?.parent_name ?? "";
    return (!child || name.toLowerCase().includes(child.toLowerCase())) &&
      (!parent || par.toLowerCase().includes(parent.toLowerCase()));
  }), [rows, child, parent]);

  const allSelected = filtered.length > 0 && filtered.every(r => selected.has(r.id));
  const toggleAll = () => {
    const next = new Set(selected);
    if (allSelected) filtered.forEach(r => next.delete(r.id));
    else filtered.forEach(r => next.add(r.id));
    setSelected(next);
  };
  const toggleOne = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const handleBatchDelete = async () => {
    if (!selected.size) return;
    if (!confirm(`Delete ${selected.size} attendance record(s)?`)) return;
    const ids = Array.from(selected);
    const { error } = await supabase.from("attendance").delete().in("id", ids);
    if (error) return toast.error(error.message);
    toast.success(`Deleted ${ids.length}`);
    window.dispatchEvent(new Event(ATTENDANCE_CHANGED_EVENT));
  };

  const exportCSV = () => {
    if (!filtered.length) return toast.info("Nothing to export");
    downloadCSV(`attendance_${date || "all"}.csv`,
      filtered.map(r => {
        const isMember = !!r.serve_team;
        const age = r.children?.age ?? (r.serve_team ? ageFromBirthday(r.serve_team.birthday) : "");
        return {
          date: r.attendance_date,
          time: r.attendance_time?.slice(0, 5),
          name: r.children?.full_name ?? r.serve_team?.full_name ?? "",
          type: isMember ? "Serve Team" : "Child",
          age,
          category: isMember ? "Serve Team" : (r.children ? ageCategory(r.children.age).label : ""),
          parent: r.children?.parent_name ?? "",
          service: r.service_schedule,
          method: r.method.toUpperCase(),
        };
      }));
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Attendance Records</h1>
        <p className="text-muted-foreground mt-1">Records older than 30 days are auto-purged.</p>
      </div>

      <AttendanceStats title="Today's Check-ins (All)" refreshKey={statsRefreshKey} />

      <Card className="overflow-hidden py-0 gap-0 shadow-sm">
        <TableToolbar
          primary={
            <div className="flex w-full flex-col gap-4 xl:flex-row xl:items-end">
              <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Date</Label>
                  <Input
                    type="date"
                    value={date}
                    onChange={e => { setDate(e.target.value); setPage(0); }}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Child name</Label>
                  <Input placeholder="Filter…" value={child} onChange={e => setChild(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Parent name</Label>
                  <Input placeholder="Filter…" value={parent} onChange={e => setParent(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Service</Label>
                  <Input
                    placeholder="e.g. Sunday"
                    value={service}
                    onChange={e => { setService(e.target.value); setPage(0); }}
                  />
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2 xl:pb-0.5">
                <Button size="sm" variant="outline" onClick={exportCSV}>
                  <FileDown className="h-4 w-4 sm:mr-2" />
                  <span className="hidden sm:inline">Export CSV</span>
                </Button>
                <Link to="/manual">
                  <Button size="sm" variant="outline">
                    <UserPlus className="h-4 w-4 sm:mr-2" />
                    <span className="hidden sm:inline">Manual Check-In</span>
                    <span className="sm:hidden">Check-In</span>
                  </Button>
                </Link>
              </div>
            </div>
          }
          footer={
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setDate(""); setChild(""); setParent(""); setService(""); setPage(0); }}
              >
                Clear filters
              </Button>
              {selected.size > 0 && (
                <Button variant="destructive" size="sm" onClick={handleBatchDelete}>
                  <Trash2 className="h-4 w-4 mr-2" />Delete Selected ({selected.size})
                </Button>
              )}
            </>
          }
        />
        <CardContent className="p-0 pb-6 pt-0">
          <div className="overflow-x-auto px-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10"><Checkbox checked={allSelected} onCheckedChange={toggleAll} /></TableHead>
                <TableHead>Date</TableHead><TableHead>Time</TableHead>
                <TableHead>Name</TableHead><TableHead>Type</TableHead><TableHead>Parent</TableHead>
                <TableHead>Service</TableHead><TableHead>Method</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>}
              {!loading && filtered.length === 0 && (
                <TableRow><TableCell colSpan={8} className="text-center py-12 text-muted-foreground">No records found.</TableCell></TableRow>
              )}
              {filtered.map(r => {
                const isMember = !!r.serve_team;
                const name = r.children?.full_name ?? r.serve_team?.full_name ?? "—";
                return (
                  <TableRow key={r.id} data-state={selected.has(r.id) ? "selected" : undefined}>
                    <TableCell><Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggleOne(r.id)} /></TableCell>
                    <TableCell>{r.attendance_date}</TableCell>
                    <TableCell>{r.attendance_time?.slice(0,5)}</TableCell>
                    <TableCell className="font-medium">{name}</TableCell>
                    <TableCell>
                      {isMember
                        ? <Badge className="bg-primary text-primary-foreground">Serve Team</Badge>
                        : r.children ? <Badge variant="secondary">{ageCategory(r.children.age).label}</Badge> : "—"}
                    </TableCell>
                    <TableCell>{r.children?.parent_name ?? "—"}</TableCell>
                    <TableCell>{r.service_schedule}</TableCell>
                    <TableCell><Badge variant={r.method === "qr" ? "default" : "secondary"}>{r.method.toUpperCase()}</Badge></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
            <span className="text-xs text-muted-foreground">Page {page + 1}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous</Button>
              <Button variant="outline" size="sm" disabled={rows.length < PAGE} onClick={() => setPage(p => p + 1)}>Next</Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
