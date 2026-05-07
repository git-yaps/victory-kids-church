import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Search, UserPlus } from "lucide-react";

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

  const load = async () => {
    setLoading(true);
    let q = supabase.from("attendance")
      .select("id,attendance_date,attendance_time,service_schedule,method,children(full_name,parent_name,age)")
      .order("attendance_date", { ascending: false })
      .order("attendance_time", { ascending: false })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (date) q = q.eq("attendance_date", date);
    if (service) q = q.ilike("service_schedule", `%${service}%`);
    const { data, error } = await q;
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    setRows((data as any) ?? []);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [date, service, page]);

  const filtered = useMemo(() => rows.filter(r =>
    (!child || r.children?.full_name.toLowerCase().includes(child.toLowerCase())) &&
    (!parent || r.children?.parent_name.toLowerCase().includes(parent.toLowerCase()))
  ), [rows, child, parent]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Attendance Records</h1>
          <p className="text-muted-foreground mt-1">Search and filter attendance history.</p>
        </div>
        <Link to="/manual"><Button variant="outline"><UserPlus className="h-4 w-4 mr-2" />Manual Check-In</Button></Link>
      </div>

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
          <div className="flex gap-2 mt-2">
            <Button variant="ghost" size="sm" onClick={() => { setDate(""); setChild(""); setParent(""); setService(""); setPage(0); }}>Clear filters</Button>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead><TableHead>Time</TableHead>
                <TableHead>Child</TableHead><TableHead>Parent</TableHead>
                <TableHead>Service</TableHead><TableHead>Method</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>}
              {!loading && filtered.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center py-12 text-muted-foreground">No records found.</TableCell></TableRow>
              )}
              {filtered.map(r => (
                <TableRow key={r.id}>
                  <TableCell>{r.attendance_date}</TableCell>
                  <TableCell>{r.attendance_time?.slice(0,5)}</TableCell>
                  <TableCell className="font-medium">{r.children?.full_name ?? "—"}</TableCell>
                  <TableCell>{r.children?.parent_name ?? "—"}</TableCell>
                  <TableCell>{r.service_schedule}</TableCell>
                  <TableCell><Badge variant={r.method === "qr" ? "default" : "secondary"}>{r.method.toUpperCase()}</Badge></TableCell>
                </TableRow>
              ))}
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
