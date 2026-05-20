import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { LayoutDashboard, Users, ListChecks, LogOut, Menu, X, WifiOff, Wifi, HandHeart } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { syncQueue, getQueuedCount } from "@/lib/offline-queue";
import { toast } from "sonner";
import { ScannerFAB } from "@/components/ScannerFAB";

const nav = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/children", label: "Children", icon: Users },
  { to: "/serve", label: "Serve Team", icon: HandHeart },
  { to: "/records", label: "Attendance", icon: ListChecks },
] as const;

export function AppShell() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const { location } = useRouterState();
  const [open, setOpen] = useState(false);
  const [online, setOnline] = useState(true);
  const [queued, setQueued] = useState(0);

  useEffect(() => {
    if (!loading && !session) navigate({ to: "/login" });
  }, [loading, session, navigate]);

  useEffect(() => {
    const update = () => {
      setOnline(navigator.onLine);
      setQueued(getQueuedCount());
    };
    update();
    const onOnline = async () => {
      setOnline(true);
      const r = await syncQueue();
      setQueued(getQueuedCount());
      if (r.synced) toast.success(`Synced ${r.synced} offline record${r.synced > 1 ? "s" : ""}`);
    };
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    const i = setInterval(update, 5000);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      clearInterval(i);
    };
  }, []);

  if (loading || !session) {
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Loading...</div>;
  }

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/login" });
  };

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar */}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-40 w-64 bg-sidebar text-sidebar-foreground flex flex-col transition-transform md:translate-x-0 md:static md:inset-auto",
        open ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="px-6 py-6 border-b border-sidebar-border">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-sidebar-primary text-sidebar-primary-foreground flex items-center justify-center font-bold">VK</div>
            <div>
              <div className="font-bold leading-tight">Victory Kids</div>
              <div className="text-xs opacity-80">Attendance System</div>
            </div>
          </div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {nav.map(({ to, label, icon: Icon }) => {
            const active = location.pathname.startsWith(to);
            return (
              <Link key={to} to={to} onClick={() => setOpen(false)}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                  active ? "bg-sidebar-primary text-sidebar-primary-foreground" : "hover:bg-sidebar-accent"
                )}>
                <Icon className="h-4 w-4" /> {label}
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t border-sidebar-border">
          <div className="flex items-center justify-between px-3 py-2 mb-2 text-xs">
            <span className="flex items-center gap-1.5">
              {online ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
              {online ? "Online" : "Offline"}
            </span>
            {queued > 0 && <span className="bg-sidebar-accent rounded-full px-2 py-0.5">{queued} queued</span>}
          </div>
          <Button variant="ghost" className="w-full justify-start text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground" onClick={handleLogout}>
            <LogOut className="h-4 w-4 mr-2" /> Logout
          </Button>
        </div>
      </aside>

      {open && <div className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={() => setOpen(false)} />}

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="md:hidden sticky top-0 z-20 bg-card border-b px-4 py-3 flex items-center gap-3">
          <button onClick={() => setOpen(o => !o)} className="p-1.5 rounded-md hover:bg-accent">
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <span className="font-semibold">Victory Kids Attendance</span>
        </header>
        <main className="flex-1 p-4 md:p-8 overflow-x-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
