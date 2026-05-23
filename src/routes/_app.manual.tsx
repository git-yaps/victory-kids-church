import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Search, UserCheck } from "lucide-react";
import { enqueueAttendance } from "@/lib/offline-queue";
import { DEFAULT_CHILD_ATTENDANCE_SERVICE } from "@/lib/utils-app";

export const Route = createFileRoute("/_app/manual")({
  component: ManualPage,
});

type ChildRow = {
  id: string;
  full_name: string | null;
  parent_name: string | null;
  birthday: string | null;
};

function displayName(c: Pick<ChildRow, "full_name">) {
  const n = (c.full_name ?? "").trim();
  return n || "(Unnamed)";
}

function ManualPage() {
  const [q, setQ] = useState("");
  const [children, setChildren] = useState<ChildRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("children").select("id, full_name, parent_name, birthday").order("full_name").then(({ data, error }) => {
      if (error) toast.error(error.message); else setChildren((data as ChildRow[]) ?? []);
    });
  }, []);

  const matches = useMemo(() => {
    if (!q.trim()) return [];
    const s = q.toLowerCase();
    return children
      .filter(c => {
        const name = (c.full_name ?? "").toLowerCase();
        const parent = (c.parent_name ?? "").toLowerCase();
        return name.includes(s) || parent.includes(s);
      })
      .slice(0, 20);
  }, [q, children]);

  const checkIn = async (c: ChildRow) => {
    const label = displayName(c);
    setBusy(c.id);
    const payload = {
      child_id: c.id,
      service_schedule: DEFAULT_CHILD_ATTENDANCE_SERVICE,
      attendance_date: new Date().toISOString().slice(0, 10),
      attendance_time: new Date().toTimeString().slice(0, 8),
      method: "manual" as const,
    };
    if (!navigator.onLine) {
      enqueueAttendance(payload);
      toast.success(`${label} — saved offline`);
      setBusy(null); return;
    }
    const { error } = await supabase.from("attendance").insert(payload);
    setBusy(null);
    if (error) {
      if (error.message.toLowerCase().includes("duplicate") || (error as any).code === "23505") {
        toast.info(`${label} is already checked in today`);
      } else toast.error(error.message);
    } else toast.success(`${label} checked in`);
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Manual Check-In</h1>
        <p className="text-muted-foreground mt-1">Search by child or parent name when QR isn&apos;t available.</p>
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
            <p className="text-center text-muted-foreground py-8 text-sm">No children match &quot;{q}&quot;</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Parent</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {matches.map(c => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{displayName(c)}</TableCell>
                    <TableCell>{c.parent_name ?? "—"}</TableCell>
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
