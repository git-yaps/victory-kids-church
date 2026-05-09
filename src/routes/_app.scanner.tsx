import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { CheckCircle2, ScanLine, XCircle } from "lucide-react";
import { enqueueAttendance } from "@/lib/offline-queue";
import { ageCategory, ageFromBirthday } from "@/lib/utils-app";

export const Route = createFileRoute("/_app/scanner")({
  component: Scanner,
});

type Person = { kind: "child" | "member"; full_name: string; age: number; parent_name?: string; service_schedule: string };
type LastResult = { ok: boolean; person?: Person; message: string; ts: number };
type Mode = "camera" | "hardware";

function Scanner() {
  const containerId = "qr-reader";
  const [scanning, setScanning] = useState(false);
  const [mode, setMode] = useState<Mode>("camera");
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
    const id = payload?.id;
    if (!id) {
      setLast({ ok: false, message: "QR missing ID", ts: Date.now() });
      return;
    }
    const isMember = payload?.type === "member";
    let person: Person | null = null;
    let attendance: any;

    if (isMember) {
      const { data, error } = await supabase.from("serve_team" as any).select("*").eq("id", id).maybeSingle();
      if (error || !data) {
        setLast({ ok: false, message: "Serve team member not found", ts: Date.now() });
        return;
      }
      const m = data as any;
      person = { kind: "member", full_name: m.full_name, age: ageFromBirthday(m.birthday), service_schedule: m.service_schedule };
      attendance = {
        member_id: m.id,
        service_schedule: m.service_schedule,
        attendance_date: new Date().toISOString().slice(0, 10),
        attendance_time: new Date().toTimeString().slice(0, 8),
        method: "qr" as const,
      };
    } else {
      const { data, error } = await supabase.from("children").select("*").eq("id", id).maybeSingle();
      if (error || !data) {
        setLast({ ok: false, message: "Child not found", ts: Date.now() });
        return;
      }
      person = { kind: "child", full_name: data.full_name, age: data.age, parent_name: data.parent_name, service_schedule: data.service_schedule };
      attendance = {
        child_id: data.id,
        service_schedule: data.service_schedule,
        attendance_date: new Date().toISOString().slice(0, 10),
        attendance_time: new Date().toTimeString().slice(0, 8),
        method: "qr" as const,
      };
    }

    if (!navigator.onLine) {
      enqueueAttendance(attendance);
      setLast({ ok: true, person, message: "Saved offline — will sync when back online", ts: Date.now() });
      toast.success(`${person.full_name} — saved offline`);
      return;
    }

    const { error: insertErr } = await supabase.from("attendance").insert(attendance);
    if (insertErr) {
      if (insertErr.message.toLowerCase().includes("duplicate") || (insertErr as any).code === "23505") {
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
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">QR Scanner</h1>
        <p className="text-muted-foreground mt-1">Point the camera at a child's QR badge.</p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
          <CardTitle className="flex items-center gap-2"><ScanLine className="h-5 w-5" /> Scanner</CardTitle>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-md border bg-muted p-0.5">
              <Button
                size="sm"
                variant={mode === "camera" ? "default" : "ghost"}
                onClick={() => { if (mode !== "camera") { stop(); setMode("camera"); } }}
              >
                Camera
              </Button>
              <Button
                size="sm"
                variant={mode === "hardware" ? "default" : "ghost"}
                onClick={() => { if (mode !== "hardware") { stop(); setMode("hardware"); } }}
              >
                QR Scanner
              </Button>
            </div>
            {mode === "camera" && (scanning ? (
              <Button variant="outline" onClick={stop}>Stop</Button>
            ) : (
              <Button onClick={start}>Start Camera</Button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {mode === "camera" ? (
            <>
              <div id={containerId} className="w-full max-w-md mx-auto rounded-lg overflow-hidden bg-muted aspect-square" />
              {!scanning && (
                <p className="text-sm text-muted-foreground text-center">Click "Start Camera" and allow camera access.</p>
              )}
            </>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="hw-scanner" className="text-sm font-medium">Physical QR scanner / manual paste</Label>
              <Input
                id="hw-scanner"
                autoFocus
                placeholder="Focus here and scan with USB/Bluetooth scanner, then it submits on Enter"
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
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">Most USB/Bluetooth QR scanners act as keyboards — keep this field focused while scanning.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {last && (
        <Card className={last.ok ? "border-success" : "border-destructive"}>
          <CardContent className="p-6 flex items-start gap-4">
            {last.ok ? <CheckCircle2 className="h-8 w-8 text-success shrink-0" /> : <XCircle className="h-8 w-8 text-destructive shrink-0" />}
            <div className="flex-1 space-y-2">
              {last.person && (
                <>
                  <div className="text-xl font-bold">{last.person.full_name}</div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary">Age {last.person.age}</Badge>
                    {last.person.kind === "child"
                      ? <Badge className={ageCategory(last.person.age).tone}>{ageCategory(last.person.age).label}</Badge>
                      : <Badge className="bg-primary text-primary-foreground">Serve Team</Badge>}
                    <Badge variant="outline">{last.person.service_schedule}</Badge>
                  </div>
                  {last.person.parent_name && <div className="text-sm text-muted-foreground">Parent: {last.person.parent_name}</div>}
                </>
              )}
              <div className={`text-sm font-medium ${last.ok ? "text-success" : "text-destructive"}`}>{last.message}</div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
