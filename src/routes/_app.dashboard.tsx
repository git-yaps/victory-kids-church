import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, ScanLine, ListChecks, UserPlus, CalendarCheck } from "lucide-react";

export const Route = createFileRoute("/_app/dashboard")({
  component: Dashboard,
});

function Dashboard() {
  const [stats, setStats] = useState({ children: 0, today: 0, week: 0 });

  useEffect(() => {
    (async () => {
      const today = new Date().toISOString().slice(0, 10);
      const weekAgo = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
      const [c, t, w] = await Promise.all([
        supabase.from("children").select("id", { count: "exact", head: true }),
        supabase.from("attendance").select("id", { count: "exact", head: true }).eq("attendance_date", today),
        supabase.from("attendance").select("id", { count: "exact", head: true }).gte("attendance_date", weekAgo),
      ]);
      setStats({ children: c.count ?? 0, today: t.count ?? 0, week: w.count ?? 0 });
    })();
  }, []);

  const tiles = [
    { label: "Registered Children", value: stats.children, icon: Users, color: "bg-primary text-primary-foreground" },
    { label: "Checked In Today", value: stats.today, icon: CalendarCheck, color: "bg-success text-success-foreground" },
    { label: "Last 7 Days", value: stats.week, icon: ListChecks, color: "bg-accent text-accent-foreground" },
  ];

  const actions = [
    { to: "/scanner", label: "Open QR Scanner", desc: "Scan child QR codes for instant check-in", icon: ScanLine },
    { to: "/children", label: "Register a Child", desc: "Add new child and generate QR badge", icon: UserPlus },
    { to: "/records", label: "View Attendance", desc: "Search and filter attendance records", icon: ListChecks },
  ] as const;

  return (
    <div className="space-y-8 max-w-6xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-1">Welcome back to {"\n"} attendance.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {tiles.map(t => (
          <Card key={t.label} className="overflow-hidden">
            <CardContent className="p-6 flex items-center gap-4">
              <div className={`h-12 w-12 rounded-xl flex items-center justify-center ${t.color}`}>
                <t.icon className="h-6 w-6" />
              </div>
              <div>
                <div className="text-3xl font-bold">{t.value}</div>
                <div className="text-sm text-muted-foreground">{t.label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-3">Quick Actions</h2>
        <div className="grid gap-3 md:grid-cols-3">
          {actions.map(a => (
            <Link key={a.to} to={a.to} className="group">
              <Card className="h-full transition-shadow group-hover:shadow-md">
                <CardHeader>
                  <div className="h-10 w-10 rounded-lg bg-accent text-accent-foreground flex items-center justify-center mb-2">
                    <a.icon className="h-5 w-5" />
                  </div>
                  <CardTitle className="text-base">{a.label}</CardTitle>
                </CardHeader>
                <CardContent className="pt-0 text-sm text-muted-foreground">{a.desc}</CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
