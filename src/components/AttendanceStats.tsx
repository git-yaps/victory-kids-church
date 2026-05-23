import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Clock } from "lucide-react";

type Filter = "all" | "child" | "member";

const SLOTS: { label: string; hour: number }[] = [
  { label: "9 AM", hour: 9 },
  { label: "11 AM", hour: 11 },
  { label: "1 PM", hour: 13 },
  { label: "3 PM", hour: 15 },
  { label: "5 PM", hour: 17 },
];

interface Props {
  filter?: Filter;
  title?: string;
  /** Increment or change to force a refetch of the same date (e.g. after add/remove attendance elsewhere). */
  refreshKey?: number;
  /**
   * When both are provided, the date input is omitted here — bind it in the page toolbar
   * so it stays in sync with these props.
   */
  statsDate?: string;
  onStatsDateChange?: (isoDate: string) => void;
}

export function AttendanceStats({
  filter = "all",
  title = "Today's Check-ins",
  refreshKey = 0,
  statsDate: statsDateProp,
  onStatsDateChange,
}: Props) {
  const today = new Date().toISOString().slice(0, 10);
  const [internalDate, setInternalDate] = useState(today);
  const externalPicker = statsDateProp !== undefined && onStatsDateChange !== undefined;
  const date = externalPicker ? statsDateProp : internalDate;
  const setDate = externalPicker ? onStatsDateChange : setInternalDate;
  const [counts, setCounts] = useState<number[]>([0, 0, 0, 0, 0]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      let q = supabase
        .from("attendance")
        .select("attendance_time,child_id,member_id")
        .eq("attendance_date", date);
      if (filter === "child") q = q.not("child_id", "is", null);
      if (filter === "member") q = q.not("member_id", "is", null);
      const { data, error } = await q;
      if (cancelled) return;
      setLoading(false);
      if (error || !data) {
        setCounts([0, 0, 0, 0, 0]);
        return;
      }
      type SlotRow = { attendance_time?: string | null };
      const rows = data as SlotRow[];
      const next = SLOTS.map(
        (s) =>
          rows.filter((r) => {
            const h = parseInt((r.attendance_time ?? "").slice(0, 2), 10);
            return h === s.hour;
          }).length,
      );
      setCounts(next);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [date, filter, refreshKey]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
        {!externalPicker && (
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="h-8 w-auto text-xs"
          />
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {SLOTS.map((s, i) => (
          <Card key={s.label} className="border-l-4 border-l-primary">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs">
                <Clock className="h-3 w-3" />
                {s.label}
              </div>
              <div className="text-2xl font-bold mt-1 tabular-nums">
                {loading ? "—" : counts[i]}
              </div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
                attendees
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
