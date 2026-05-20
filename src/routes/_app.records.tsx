import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { UserPlus, FileDown, Trash2 } from "lucide-react";
import { downloadCSV, ageCategory, ageFromBirthday } from "@/lib/utils-app";
import { AttendanceStats } from "@/components/AttendanceStats";

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

  const load = async () => {
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
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [date, service, page]);

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
    toast.success(`Deleted ${ids.length}`); load();
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
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Attendance Records</h1>
          <p className="text-muted-foreground mt-1">Records older than 30 days are auto-purged.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportCSV}><FileDown className="h-4 w-4 mr-2" />Export CSV</Button>
          <Link to="/manual"><Button variant="outline"><UserPlus className="h-4 w-4 mr-2" />Manual Check-In</Button></Link>
        </div>
      </div>

      <AttendanceStats title="Today's Check-ins (All)" />

      <Card>
        <CardHeader>
          <div className="grid gap-3 md:grid-cols-4">
            <div><label className="text-xs text-muted-foreground">Date</label>
              <Input type="date" value={date} onChange={e => { setDate(e.target.value); setPage(0); }} /></div>
            <div><label className="text-xs text-muted-foreground">Child name</label>
              <Input placeholder="Filter..." value={child} onChange={e => setChild(e.target.value)} /></div>
            <div><label className="text-xs text-muted-foreground">Parent name</label>
              <Input placeholder="Filter..." value={parent} onChange={e => setParent(e.target.value)} /></div>
            <div><label className="text-xs text-muted-foreground">Service</label>
              <Input placeholder="e.g. Sunday" value={service} onChange={e => { setService(e.target.value); setPage(0); }} /></div>
          </div>
          <div className="flex gap-2 mt-2 items-center">
            <Button variant="ghost" size="sm" onClick={() => { setDate(""); setChild(""); setParent(""); setService(""); setPage(0); }}>Clear filters</Button>
            {selected.size > 0 && (
              <Button variant="destructive" size="sm" onClick={handleBatchDelete}>
                <Trash2 className="h-4 w-4 mr-2" />Delete Selected ({selected.size})
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
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
          <div className="flex justify-between items-center pt-4">
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
