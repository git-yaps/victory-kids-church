import { supabase } from "@/integrations/supabase/client";

export type QueuedAttendance = {
  id: string;
  child_id: string;
  service_schedule: string;
  attendance_date: string;
  attendance_time: string;
  method: "qr" | "manual";
  queued_at: number;
};

const KEY = "vkc_offline_attendance";

function read(): QueuedAttendance[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; }
}
function write(items: QueuedAttendance[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(items));
}

export function enqueueAttendance(item: Omit<QueuedAttendance, "id" | "queued_at">) {
  const items = read();
  items.push({ ...item, id: crypto.randomUUID(), queued_at: Date.now() });
  write(items);
}

export function getQueuedCount() { return read().length; }

export async function syncQueue(): Promise<{ synced: number; failed: number }> {
  const items = read();
  if (!items.length) return { synced: 0, failed: 0 };
  let synced = 0, failed = 0;
  const remaining: QueuedAttendance[] = [];
  for (const it of items) {
    const { error } = await supabase.from("attendance").insert({
      child_id: it.child_id,
      service_schedule: it.service_schedule,
      attendance_date: it.attendance_date,
      attendance_time: it.attendance_time,
      method: it.method,
    });
    if (error && !error.message.toLowerCase().includes("duplicate")) {
      remaining.push(it); failed++;
    } else {
      synced++;
    }
  }
  write(remaining);
  return { synced, failed };
}
