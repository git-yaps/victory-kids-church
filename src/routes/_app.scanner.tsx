import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { CheckCircle2, ScanLine, XCircle } from "lucide-react";
import { enqueueAttendance } from "@/lib/offline-queue";

export const Route = createFileRoute("/_app/scanner")({
  component: Scanner,
});

type LastResult = { ok: boolean; name?: string; service?: string; message: string; ts: number };

function Scanner() {
  const containerId = "qr-reader";
  const [scanning, setScanning] = useState(false);
  const [last, setLast] = useState<LastResult | null>(null);
  const scannerRef = useRef<any>(null);
  const processingRef = useRef(false);
  const recentRef = useRef<Map<string, number>>(new Map());

  useEffect(() => () => { stop(); }, []);

  async function start() {
    if (scanning) return;
    const { Html5Qrcode } = await import("html5-qrcode");
    const html5 = new Html5Qrcode(containerId);
    scannerRef.current = html5;
    try {
      await html5.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 260, height: 260 } },
        onScan,
        () => {}
      );
      setScanning(true);
    } catch (e: any) {
      toast.error(e?.message || "Could not access camera");
    }
  }

  async function stop() {
    try {
      if (scannerRef.current) {
        await scannerRef.current.stop();
        await scannerRef.current.clear();
        scannerRef.current = null;
      }
    } catch {}
    setScanning(false);
  }

  async function onScan(text: string) {
    if (processingRef.current) return;
    const now = Date.now();
    const last = recentRef.current.get(text);
    if (last && now - last < 3000) return;
    recentRef.current.set(text, now);
    processingRef.current = true;
    try {
      await handleCode(text);
    } finally {
      setTimeout(() => { processingRef.current = false; }, 800);
    }
  }

  async function handleCode(text: string) {
    let payload: any;
    try { payload = JSON.parse(text); } catch {
      setLast({ ok: false, message: "Invalid QR code", ts: Date.now() });
      return;
    }
    const childId = payload?.id;
    if (!childId) {
      setLast({ ok: false, message: "QR missing child ID", ts: Date.now() });
      return;
    }
    const { data: child, error } = await supabase.from("children").select("*").eq("id", childId).maybeSingle();
    if (error || !child) {
      setLast({ ok: false, message: "Child not found", ts: Date.now() });
      return;
    }
    const attendance = {
      child_id: child.id,
      service_schedule: child.service_schedule,
      attendance_date: new Date().toISOString().slice(0, 10),
      attendance_time: new Date().toTimeString().slice(0, 8),
      method: "qr" as const,
    };

    if (!navigator.onLine) {
      enqueueAttendance(attendance);
      setLast({ ok: true, name: child.full_name, service: child.service_schedule, message: "Saved offline — will sync when back online", ts: Date.now() });
      toast.success(`${child.full_name} — saved offline`);
      return;
    }

    const { error: insertErr } = await supabase.from("attendance").insert(attendance);
    if (insertErr) {
      if (insertErr.message.toLowerCase().includes("duplicate") || (insertErr as any).code === "23505") {
        setLast({ ok: false, name: child.full_name, message: "Already checked in today", ts: Date.now() });
        toast.info(`${child.full_name} is already checked in today`);
      } else {
        setLast({ ok: false, message: insertErr.message, ts: Date.now() });
        toast.error(insertErr.message);
      }
      return;
    }
    setLast({ ok: true, name: child.full_name, service: child.service_schedule, message: "Checked in successfully", ts: Date.now() });
    toast.success(`${child.full_name} checked in`);
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">QR Scanner</h1>
        <p className="text-muted-foreground mt-1">Point the camera at a child's QR badge.</p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2"><ScanLine className="h-5 w-5" /> Scanner</CardTitle>
          {scanning ? (
            <Button variant="outline" onClick={stop}>Stop</Button>
          ) : (
            <Button onClick={start}>Start Camera</Button>
          )}
        </CardHeader>
        <CardContent>
          <div id={containerId} className="w-full max-w-md mx-auto rounded-lg overflow-hidden bg-muted aspect-square" />
          {!scanning && (
            <p className="text-sm text-muted-foreground text-center mt-4">Click "Start Camera" and allow camera access.</p>
          )}
        </CardContent>
      </Card>

      {last && (
        <Card className={last.ok ? "border-success" : "border-destructive"}>
          <CardContent className="p-6 flex items-start gap-4">
            {last.ok ? <CheckCircle2 className="h-8 w-8 text-success shrink-0" /> : <XCircle className="h-8 w-8 text-destructive shrink-0" />}
            <div className="flex-1">
              {last.name && <div className="text-lg font-semibold">{last.name}</div>}
              {last.service && <Badge variant="secondary" className="mt-1">{last.service}</Badge>}
              <div className="text-sm text-muted-foreground mt-2">{last.message}</div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
