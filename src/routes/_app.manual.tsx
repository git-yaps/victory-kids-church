import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Search, UserCheck } from "lucide-react";
import { enqueueAttendance } from "@/lib/offline-queue";

export const Route = createFileRoute("/_app/manual")({
  component: ManualPage,
});

type Child = { id: string; full_name: string; age: number; parent_name: string; service_schedule: string };

function ManualPage() {
  const [q, setQ] = useState("");
  const [children, setChildren] = useState<Child[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("children").select("*").order("full_name").then(({ data, error }) => {
      if (error) toast.error(error.message); else setChildren((data as Child[]) ?? []);
    });
  }, []);

  const matches = useMemo(() => {
    if (!q.trim()) return [];
    const s = q.toLowerCase();
    return children.filter(c => c.full_name.toLowerCase().includes(s) || c.parent_name.toLowerCase().includes(s)).slice(0, 20);
  }, [q, children]);

  const checkIn = async (c: Child) => {
    setBusy(c.id);
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
      setBusy(null); return;
    }
    const { error } = await supabase.from("attendance").insert(payload);
    setBusy(null);
    if (error) {
      if (error.message.toLowerCase().includes("duplicate") || (error as any).code === "23505") {
        toast.info(`${c.full_name} is already checked in today`);
      } else toast.error(error.message);
    } else toast.success(`${c.full_name} checked in`);
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Manual Check-In</h1>
        <p className="text-muted-foreground mt-1">Search by child or parent name when QR isn't available.</p>
      </div>

      <Card>
        <CardHeader>
          <div className="relative">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input autoFocus placeholder="Type a name..." className="pl-9 text-base h-11" value={q} onChange={e => setQ(e.target.value)} />
          </div>
        </CardHeader>
        <CardContent>
          {q.trim() === "" ? (
            <p className="text-center text-muted-foreground py-8 text-sm">Start typing to search</p>
          ) : matches.length === 0 ? (
            <p className="text-center text-muted-foreground py-8 text-sm">No children match "{q}"</p>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Parent</TableHead><TableHead>Service</TableHead><TableHead></TableHead></TableRow></TableHeader>
              <TableBody>
                {matches.map(c => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.full_name}</TableCell>
                    <TableCell>{c.parent_name}</TableCell>
                    <TableCell>{c.service_schedule}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" disabled={busy === c.id} onClick={() => checkIn(c)}>
                        <UserCheck className="h-4 w-4 mr-1" />Check In
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
