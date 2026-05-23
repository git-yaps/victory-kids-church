import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { CheckCircle2, ScanLine, XCircle } from "lucide-react";
import { enqueueAttendance } from "@/lib/offline-queue";
import {
  ageCategory,
  ageFromBirthday,
  displayChildAge,
  DEFAULT_CHILD_ATTENDANCE_SERVICE,
  isChildrenOnlyAttendanceServiceSchedule,
} from "@/lib/utils-app";

function displayName(full_name: unknown) {
  const n = typeof full_name === "string" ? full_name.trim() : "";
  return n || "(Unnamed)";
}

type Person = {
  kind: "child" | "member";
  full_name: string;
  age: number | null;
  parent_name?: string;
  service_schedule?: string;
};
type LastResult = { ok: boolean; person?: Person; message: string; ts: number };

export function ScannerFAB() {
  const [open, setOpen] = useState(false);
  const [last, setLast] = useState<LastResult | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const containerId = "qr-reader-fab";
  const scannerRef = useRef<any>(null);
  const processingRef = useRef(false);
  const recentRef = useRef<Map<string, number>>(new Map());
  const hwInputRef = useRef<HTMLInputElement>(null);

  // Auto-start camera whenever dialog opens; stop on close.
  useEffect(() => {
    if (!open) {
      stop();
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        if (cancelled) return;
        const html5 = new Html5Qrcode(containerId);
        scannerRef.current = html5;
        await html5.start(
          { facingMode: "environment" },
          {
            fps: 10,
            // Square preview + square scan region so the shaded finder matches geometry.
            aspectRatio: 1,
            qrbox: (viewfinderWidth, viewfinderHeight) => {
              const minSide = Math.min(viewfinderWidth, viewfinderHeight);
              const edge = Math.min(
                minSide,
                Math.max(50, Math.floor(minSide * 0.72)),
              );
              return { width: edge, height: edge };
            },
          },
          onScan,
          () => {},
        );
        if (!cancelled) setCameraReady(true);
      } catch (e: any) {
        if (!cancelled) toast.error(e?.message || "Could not access camera");
      }
    })();
    return () => {
      cancelled = true;
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function stop() {
    setCameraReady(false);
    try {
      if (scannerRef.current) {
        await scannerRef.current.stop();
        await scannerRef.current.clear();
        scannerRef.current = null;
      }
    } catch {}
  }

  async function onScan(text: string) {
    if (processingRef.current) return;
    const now = Date.now();
    const prev = recentRef.current.get(text);
    if (prev && now - prev < 3000) return;
    recentRef.current.set(text, now);
    processingRef.current = true;
    try {
      await handleCode(text);
    } finally {
      setTimeout(() => {
        processingRef.current = false;
      }, 800);
    }
  }

  async function handleCode(text: string) {
    let payload: any;
    try {
      payload = JSON.parse(text);
    } catch {
      setLast({ ok: false, message: "Invalid QR code", ts: Date.now() });
      return;
    }
    const id = payload?.id;
    if (!id) {
      setLast({ ok: false, message: "QR missing ID", ts: Date.now() });
      return;
    }
    const isMember = payload?.type === "member";
    let person: Person | null = null;
    let attendance: any;

    if (isMember) {
      const { data, error } = await supabase
        .from("serve_team" as any)
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error || !data) {
        setLast({ ok: false, message: "Serve team member not found", ts: Date.now() });
        return;
      }
      const m = data as any;
      if (isChildrenOnlyAttendanceServiceSchedule(m.service_schedule)) {
        const msg =
          `Serve cannot check in as "${DEFAULT_CHILD_ATTENDANCE_SERVICE}" — assign a serve service on their profile.`;
        setLast({
          ok: false,
          message: msg,
          ts: Date.now(),
        });
        toast.error(msg);
        return;
      }
      person = {
        kind: "member",
        full_name: m.full_name,
        age: ageFromBirthday(m.birthday),
        service_schedule: m.service_schedule,
      };
      attendance = {
        member_id: m.id,
        service_schedule: m.service_schedule,
        attendance_date: new Date().toISOString().slice(0, 10),
        attendance_time: new Date().toTimeString().slice(0, 8),
        method: "qr" as const,
      };
    } else {
      const { data, error } = await supabase
        .from("children")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error || !data) {
        setLast({ ok: false, message: "Child not found", ts: Date.now() });
        return;
      }
      person = {
        kind: "child",
        full_name: displayName(data.full_name),
        age: displayChildAge({ birthday: data.birthday, age: data.age }),
        parent_name: data.parent_name ?? "",
        service_schedule: DEFAULT_CHILD_ATTENDANCE_SERVICE,
      };
      attendance = {
        child_id: data.id,
        service_schedule: DEFAULT_CHILD_ATTENDANCE_SERVICE,
        attendance_date: new Date().toISOString().slice(0, 10),
        attendance_time: new Date().toTimeString().slice(0, 8),
        method: "qr" as const,
      };
    }

    if (!navigator.onLine) {
      enqueueAttendance(attendance);
      setLast({
        ok: true,
        person,
        message: "Saved offline — will sync when back online",
        ts: Date.now(),
      });
      toast.success(`${person.full_name} — saved offline`);
      return;
    }

    const { error: insertErr } = await supabase.from("attendance").insert(attendance);
    if (insertErr) {
      if (
        insertErr.message.toLowerCase().includes("duplicate") ||
        (insertErr as any).code === "23505"
      ) {
        setLast({ ok: false, person, message: "Already checked in today", ts: Date.now() });
        toast.info(`${person.full_name} is already checked in today`);
      } else {
        setLast({ ok: false, message: insertErr.message, ts: Date.now() });
        toast.error(insertErr.message);
      }
      return;
    }
    setLast({ ok: true, person, message: "Checked in successfully", ts: Date.now() });
    toast.success(`${person.full_name} checked in`);
  }

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        aria-label="Open QR scanner"
        className="fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full shadow-lg p-0"
      >
        <ScanLine className="h-6 w-6" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ScanLine className="h-5 w-5" /> QR Scanner
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div
              id={containerId}
              className="w-full rounded-lg overflow-hidden bg-muted aspect-square"
            />
            {!cameraReady && (
              <p className="text-xs text-muted-foreground text-center">
                Starting camera… allow access if prompted.
              </p>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="hw-scanner-fab" className="text-xs font-medium">
                Physical scanner / manual paste
              </Label>
              <Input
                id="hw-scanner-fab"
                ref={hwInputRef}
                autoFocus
                placeholder="Scan with USB/Bluetooth — submits on Enter"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const val = (e.target as HTMLInputElement).value.trim();
                    if (val) {
                      onScan(val);
                      (e.target as HTMLInputElement).value = "";
                    }
                  }
                }}
                className="font-mono text-xs"
              />
            </div>

            {last && (
              <div
                className={`rounded-lg border p-3 flex items-start gap-3 ${
                  last.ok ? "border-success" : "border-destructive"
                }`}
              >
                {last.ok ? (
                  <CheckCircle2 className="h-6 w-6 text-success shrink-0" />
                ) : (
                  <XCircle className="h-6 w-6 text-destructive shrink-0" />
                )}
                <div className="flex-1 space-y-1.5 min-w-0">
                  {last.person && (
                    <>
                      <div className="font-semibold truncate">{last.person.full_name}</div>
                      <div className="flex flex-wrap gap-1.5">
                        {last.person.age != null && (
                          <Badge variant="secondary">Age {last.person.age}</Badge>
                        )}
                        {last.person.age == null && last.person.kind === "child" && (
                          <Badge variant="outline">Age —</Badge>
                        )}
                        {last.person.kind === "child" ? (
                          last.person.age != null ? (
                            <Badge className={ageCategory(last.person.age).tone}>
                              {ageCategory(last.person.age).label}
                            </Badge>
                          ) : null
                        ) : (
                          <Badge className="bg-primary text-primary-foreground">Serve Team</Badge>
                        )}
                        {last.person.kind === "member" && last.person.service_schedule && (
                          <Badge variant="outline">{last.person.service_schedule}</Badge>
                        )}
                      </div>
                      {last.person.parent_name && (
                        <div className="text-xs text-muted-foreground">
                          Parent: {last.person.parent_name}
                        </div>
                      )}
                    </>
                  )}
                  <div
                    className={`text-xs font-medium ${
                      last.ok ? "text-success" : "text-destructive"
                    }`}
                  >
                    {last.message}
                  </div>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
