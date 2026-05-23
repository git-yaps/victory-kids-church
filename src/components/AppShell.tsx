import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { LayoutDashboard, Users, ListChecks, LogOut, Menu, X, HandHeart } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [queued, setQueued] = useState(0);

  useEffect(() => {
    if (!loading && !session) navigate({ to: "/login" });
  }, [loading, session, navigate]);

  useEffect(() => {
    const updateQueued = () => setQueued(getQueuedCount());
    updateQueued();
    const onOnline = async () => {
      const r = await syncQueue();
      updateQueued();
      if (r.synced) toast.success(`Synced ${r.synced} offline record${r.synced > 1 ? "s" : ""}`);
    };
    window.addEventListener("online", onOnline);
    const i = setInterval(updateQueued, 5000);
    return () => {
      window.removeEventListener("online", onOnline);
      clearInterval(i);
    };
  }, []);

  if (loading || !session) {
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Loading...</div>;
  }

  const handleLogoutConfirm = async () => {
    await supabase.auth.signOut();
    setLogoutOpen(false);
    navigate({ to: "/login" });
  };

  return (
    <div className="flex min-h-svh bg-background md:items-start">
      {/* Sidebar: full viewport height; sticky so it stays put while main content scrolls */}
      <aside
        className={cn(
          "z-40 flex h-[100dvh] w-64 shrink-0 flex-col bg-sidebar text-sidebar-foreground transition-transform",
          "fixed inset-y-0 left-0 md:relative md:h-svh md:sticky md:top-0 md:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
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
          {queued > 0 && (
            <div className="mb-2 flex justify-end px-3 py-2 text-xs">
              <span className="rounded-full bg-sidebar-accent px-2 py-0.5">{queued} queued</span>
            </div>
          )}
          <Button
            variant="ghost"
            className="w-full justify-start text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
            type="button"
            onClick={() => setLogoutOpen(true)}
          >
            <LogOut className="mr-2 h-4 w-4" /> Logout
          </Button>
        </div>
      </aside>

      {open && <div className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={() => setOpen(false)} />}

      {/* Main */}
      <div className="flex min-h-svh min-w-0 flex-1 flex-col">
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
      <ScannerFAB />

      <AlertDialog open={logoutOpen} onOpenChange={setLogoutOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Log out?</AlertDialogTitle>
            <AlertDialogDescription>
              You will need to sign in again to record or view attendance.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 sm:mt-0"
              onClick={(e) => {
                e.preventDefault();
                void handleLogoutConfirm();
              }}
            >
              Log out
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
