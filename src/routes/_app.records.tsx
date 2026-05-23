import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { FileDown, Search, UserMinus, CircleCheck } from "lucide-react";
import {
  downloadCSV,
  ageCategory,
  ageFromBirthday,
  displayChildAge,
  DEFAULT_CHILD_ATTENDANCE_SERVICE,
  normalizeServiceScheduleKey,
  SUNDAY_SERVICES,
} from "@/lib/utils-app";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AttendanceStats } from "@/components/AttendanceStats";
import { ATTENDANCE_CHANGED_EVENT, broadcastAttendanceChanged } from "@/lib/attendance-sync";
import { TableToolbar } from "@/components/TableToolbar";
import { LIST_PAGE_SIZE, TablePageNavigator } from "@/components/TablePageNavigator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_app/records")({
  component: RecordsPage,
});

const ATT_FETCH_CAP = 8000;

/** Hour blocks aligned with attendance slot cards (`AttendanceStats`); matches local `TIME` rows. */
const CHECK_IN_TIME_SLOTS = [
  { hour: 9, label: "9:00 AM", rangeStart: "09:00:00", rangeEndExclusive: "10:00:00" },
  { hour: 11, label: "11:00 AM", rangeStart: "11:00:00", rangeEndExclusive: "12:00:00" },
  { hour: 13, label: "1:00 PM", rangeStart: "13:00:00", rangeEndExclusive: "14:00:00" },
  { hour: 15, label: "3:00 PM", rangeStart: "15:00:00", rangeEndExclusive: "16:00:00" },
  { hour: 17, label: "5:00 PM", rangeStart: "17:00:00", rangeEndExclusive: "18:00:00" },
] as const;

/** DB canonical Sunday service strings → hourly bucket aligned with CHECK_IN_TIME_SLOTS. */
function hourFromSundayServiceSchedule(schedule: string): number | undefined {
  const idx = SUNDAY_SERVICES.indexOf(schedule);
  if (idx < 0) return undefined;
  return CHECK_IN_TIME_SLOTS[idx]?.hour;
}

function attendanceServiceDropdownLabel(canonicalDbValue: string): string {
  const t = canonicalDbValue.trim();
  return t.startsWith("Sunday ") ? t.slice("Sunday ".length).trimStart() : t;
}

/** Sunday services in worship order (`SUNDAY_SERVICES`), then any other schedules A→Z. */
function compareAttendanceServiceScheduleChronologically(a: string, b: string): number {
  const ia = SUNDAY_SERVICES.indexOf(a);
  const ib = SUNDAY_SERVICES.indexOf(b);
  if (ia !== -1 && ib !== -1) return ia - ib;
  if (ia !== -1) return -1;
  if (ib !== -1) return 1;
  return a.localeCompare(b);
}

type Row = {
  id: string;
  attendance_date: string;
  attendance_time: string;
  service_schedule: string;
  method: string;
  /** Use `*` embed so schemas without `children.birthday` still query successfully. */
  children: {
    full_name: string | null;
    parent_name: string | null;
    age: number | null;
    birthday?: string | null;
  } | null;
  serve_team: { full_name: string; birthday: string } | null;
};

type TypeFilterValue = "__all__" | "child" | "member";

function RecordsPage() {
  /** Rows for selected date after server-side filters */
  const [serverRows, setServerRows] = useState<Row[]>([]);
  const today = () => new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [search, setSearch] = useState("");
  /** Applies when a Sunday hourly service filter is chosen; one of the five attendance slot hours. */
  const [checkInSlotHour, setCheckInSlotHour] = useState<number>(CHECK_IN_TIME_SLOTS[0].hour);
  const [typeFilter, setTypeFilter] = useState<TypeFilterValue>("__all__");
  const [serviceSchedule, setServiceSchedule] = useState("");
  const [serviceScheduleOptions, setServiceScheduleOptions] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [statsRefreshKey, setStatsRefreshKey] = useState(0);
  const [uncheckBusyId, setUncheckBusyId] = useState<string | null>(null);
  const [batchUncheckBusy, setBatchUncheckBusy] = useState(false);
  const [uncheckDialog, setUncheckDialog] = useState<
    null | { type: "single"; row: Row } | { type: "batch"; ids: string[] }
  >(null);

  /** True while an uncheck request is running (single row from table or from dialog confirm). */
  const uncheckActionBusy = batchUncheckBusy || uncheckBusyId !== null;

  const attendanceDateFilter = date.trim() || today();

  /** Check-in time filter only applies for main Sunday hourly services (aligned with attendance slot cards). */
  const serviceIsSundaySlot =
    !!serviceSchedule && SUNDAY_SERVICES.some((label) => label === serviceSchedule);

  const checkInSlotsForToolbar = useMemo(() => {
    if (!serviceIsSundaySlot || !serviceSchedule) {
      return [...CHECK_IN_TIME_SLOTS];
    }
    const mainHour = hourFromSundayServiceSchedule(serviceSchedule);
    if (mainHour === undefined) return [...CHECK_IN_TIME_SLOTS];
    return CHECK_IN_TIME_SLOTS.filter((s) => s.hour !== mainHour);
  }, [serviceIsSundaySlot, serviceSchedule]);

  /** Avoid showing the same clock twice (service already implies one slot). */
  useEffect(() => {
    if (!serviceIsSundaySlot) return;
    setCheckInSlotHour((prev) => {
      const allowed = checkInSlotsForToolbar.map((s) => s.hour);
      if (!(allowed as number[]).includes(prev)) return allowed[0] ?? CHECK_IN_TIME_SLOTS[0].hour;
      return prev;
    });
  }, [serviceIsSundaySlot, serviceSchedule, checkInSlotsForToolbar]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from("attendance")
        .select("service_schedule")
        .eq("attendance_date", attendanceDateFilter);
      if (cancelled) return;
      if (error) {
        setServiceScheduleOptions([]);
        return;
      }
      const uniq = [...new Set((data ?? []).map((r) => r.service_schedule))].sort((a, b) =>
        a.localeCompare(b),
      );
      setServiceScheduleOptions(uniq);
    })();
    return () => {
      cancelled = true;
    };
  }, [attendanceDateFilter]);

  useEffect(() => {
    setPage(0);
  }, [attendanceDateFilter, checkInSlotHour, typeFilter, serviceSchedule]);

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from("attendance")
      .select(
        "id,attendance_date,attendance_time,service_schedule,method,children(*),serve_team(full_name,birthday)",
      )
      .eq("attendance_date", attendanceDateFilter)
      .order("attendance_time", { ascending: false });

    if (serviceSchedule) q = q.eq("service_schedule", serviceSchedule);
    if (serviceIsSundaySlot) {
      const slot = CHECK_IN_TIME_SLOTS.find((s) => s.hour === checkInSlotHour);
      if (slot) {
        q = q.gte("attendance_time", slot.rangeStart).lt("attendance_time", slot.rangeEndExclusive);
      }
    }
    if (typeFilter === "child") q = q.not("child_id", "is", null);
    if (typeFilter === "member") q = q.not("member_id", "is", null);

    const listRes = await q.limit(ATT_FETCH_CAP);
    setLoading(false);
    if (listRes.error) {
      toast.error(listRes.error.message);
      return;
    }
    const fetched = ((listRes.data as Row[]) ?? []).length;
    if (fetched >= ATT_FETCH_CAP) {
      toast.warning(
        `Showing first ${ATT_FETCH_CAP} rows for this date — narrow filters if needed.`,
      );
    }
    setServerRows((listRes.data as Row[]) ?? []);
    setSelected(new Set());
  }, [attendanceDateFilter, serviceSchedule, checkInSlotHour, typeFilter, serviceIsSundaySlot]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onSync = () => {
      setStatsRefreshKey((k) => k + 1);
      void load();
    };
    window.addEventListener(ATTENDANCE_CHANGED_EVENT, onSync);
    return () => window.removeEventListener(ATTENDANCE_CHANGED_EVENT, onSync);
  }, [load]);

  const matchRows = useMemo(() => {
    const qStr = search.trim().toLowerCase();
    if (!qStr) return serverRows;
    return serverRows.filter((r) => {
      const name = (r.children?.full_name ?? r.serve_team?.full_name ?? "")
        .toLowerCase()
        .trim();
      const par = (r.children?.parent_name ?? "").toLowerCase();
      return name.includes(qStr) || par.includes(qStr);
    });
  }, [serverRows, search]);

  const totalCount = matchRows.length;
  const recordTotalPages = totalCount <= 0 ? 1 : Math.max(1, Math.ceil(totalCount / LIST_PAGE_SIZE));

  useEffect(() => {
    const last = Math.max(0, recordTotalPages - 1);
    if (page > last) setPage(last);
  }, [recordTotalPages, page]);

  const pagedRows = useMemo(
    () => matchRows.slice(page * LIST_PAGE_SIZE, page * LIST_PAGE_SIZE + LIST_PAGE_SIZE),
    [matchRows, page],
  );

  const allSelected =
    pagedRows.length > 0 && pagedRows.every((r) => selected.has(r.id));
  const toggleAll = () => {
    const next = new Set(selected);
    if (allSelected) pagedRows.forEach((r) => next.delete(r.id));
    else pagedRows.forEach((r) => next.add(r.id));
    setSelected(next);
  };
  const toggleOne = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const removeAttendanceByIds = async (ids: string[]) => {
    const { error } = await supabase.from("attendance").delete().in("id", ids);
    if (error) {
      toast.error(error.message);
      return false;
    }
    toast.success(ids.length === 1 ? `Check-in removed` : `Unchecked ${ids.length} attendances`);
    broadcastAttendanceChanged();
    return true;
  };

  const runUncheckDialog = async () => {
    if (!uncheckDialog) return;
    if (uncheckDialog.type === "single") {
      setUncheckBusyId(uncheckDialog.row.id);
      try {
        const ok = await removeAttendanceByIds([uncheckDialog.row.id]);
        if (ok) setUncheckDialog(null);
      } finally {
        setUncheckBusyId(null);
      }
      return;
    }
    setBatchUncheckBusy(true);
    try {
      const ok = await removeAttendanceByIds(uncheckDialog.ids);
      if (ok) {
        setSelected(new Set());
        setUncheckDialog(null);
      }
    } finally {
      setBatchUncheckBusy(false);
    }
  };

  const exportCSV = () => {
    if (!matchRows.length) return toast.info("Nothing to export");
    downloadCSV(
      `attendance_${attendanceDateFilter}.csv`,
      matchRows.map((r) => {
        const isMember = !!r.serve_team;
        const childAge =
          !isMember && r.children
            ? displayChildAge({ birthday: r.children.birthday, age: r.children.age })
            : null;
        const ageExport =
          isMember && r.serve_team ? ageFromBirthday(r.serve_team.birthday) : (childAge ?? "");
        return {
          date: r.attendance_date,
          time: r.attendance_time?.slice(0, 5),
          name: (r.children?.full_name ?? r.serve_team?.full_name ?? "").trim(),
          type: isMember ? "Serve Team" : "Child",
          age: ageExport === "" ? "" : ageExport,
          category:
            isMember ? "Serve Team" : childAge !== null ? ageCategory(childAge).label : "",
          parent: r.children?.parent_name ?? "",
          service: r.service_schedule,
          method: r.method.toUpperCase(),
        };
      }),
    );
  };

  const generalKey = normalizeServiceScheduleKey(DEFAULT_CHILD_ATTENDANCE_SERVICE);

  const serviceChoices = useMemo(() => {
    return [...new Set(serviceScheduleOptions)]
      .filter((s) => normalizeServiceScheduleKey(s) !== generalKey)
      .sort(compareAttendanceServiceScheduleChronologically);
  }, [generalKey, serviceScheduleOptions]);

  const serviceDropdownValue =
    serviceSchedule &&
    normalizeServiceScheduleKey(serviceSchedule) !== generalKey &&
    serviceChoices.includes(serviceSchedule)
      ? serviceSchedule
      : "__all__";

  /** Drop kids-only attendance label and orphaned values not present in this date's dropdown list. */
  useEffect(() => {
    if (!serviceSchedule) return;
    const isGeneral = normalizeServiceScheduleKey(serviceSchedule) === generalKey;
    if (isGeneral) {
      setServiceSchedule("");
      setPage(0);
      return;
    }
    if (serviceChoices.length === 0) return;
    if (!serviceChoices.includes(serviceSchedule)) {
      setServiceSchedule("");
      setPage(0);
    }
  }, [generalKey, serviceSchedule, serviceChoices]);

  /** Five cells when Sunday slot exposes time filter; otherwise four (Search · Date · Type · Service). */
  const filterToolbarClass =
    `grid flex-1 grid-cols-1 gap-3 sm:grid-cols-2 ` +
    (serviceIsSundaySlot ? "xl:grid-cols-5" : "xl:grid-cols-4");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Attendance Records</h1>
        <p className="text-muted-foreground mt-1">Records older than 30 days are auto-purged.</p>
      </div>

      <AttendanceStats
        title="Today's Check-ins (All)"
        refreshKey={statsRefreshKey}
        statsDate={attendanceDateFilter}
        onStatsDateChange={(iso) => {
          setDate(iso);
          setPage(0);
        }}
      />

      <Card className="overflow-hidden py-0 gap-0 shadow-sm">
        <TableToolbar
          primary={
            <div className="flex w-full flex-col gap-4 xl:flex-row xl:items-center">
              <div className={filterToolbarClass}>
                <div className="relative">
                  <Search className="text-muted-foreground pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2" />
                  <Input
                    placeholder="Search name or parent…"
                    className="pl-9"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    aria-label="Search by name or parent"
                  />
                </div>
                <div>
                  <Input
                    type="date"
                    value={date}
                    onChange={(e) => {
                      setDate(e.target.value);
                      setPage(0);
                    }}
                    aria-label="Attendance date"
                  />
                </div>
                {serviceIsSundaySlot ? (
                  <div>
                    <Select
                      value={
                        checkInSlotsForToolbar.some((s) => s.hour === checkInSlotHour)
                          ? String(checkInSlotHour)
                          : String(checkInSlotsForToolbar[0]?.hour ?? checkInSlotHour)
                      }
                      onValueChange={(v) => {
                        setCheckInSlotHour(Number(v));
                        setPage(0);
                      }}
                    >
                      <SelectTrigger aria-label="Check-in hour slot">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {checkInSlotsForToolbar.map((s) => (
                          <SelectItem key={s.hour} value={String(s.hour)}>
                            {s.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
                <div>
                  <Select
                    value={typeFilter}
                    onValueChange={(v) => {
                      setTypeFilter(v as TypeFilterValue);
                      setPage(0);
                    }}
                  >
                    <SelectTrigger aria-label="Filter by check-in type">
                      <SelectValue placeholder="Type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">All types</SelectItem>
                      <SelectItem value="child">Children</SelectItem>
                      <SelectItem value="member">Serve team</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Select
                    value={serviceDropdownValue}
                    onValueChange={(v) => {
                      setServiceSchedule(v === "__all__" ? "" : v);
                      setPage(0);
                    }}
                  >
                    <SelectTrigger aria-label="Filter by checked-in service">
                      <SelectValue placeholder="Service" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">Any service</SelectItem>
                      {serviceChoices.map((s) => (
                        <SelectItem key={s} value={s}>
                          {attendanceServiceDropdownLabel(s)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Button variant="outline" onClick={exportCSV}>
                  <FileDown className="h-4 w-4 sm:mr-2" />
                  <span className="hidden sm:inline">Export CSV</span>
                </Button>
              </div>
            </div>
          }
          footer={
            <>
              <Button
                variant="ghost"
                onClick={() => {
                  setDate(today());
                  setSearch("");
                  setCheckInSlotHour(CHECK_IN_TIME_SLOTS[0].hour);
                  setTypeFilter("__all__");
                  setServiceSchedule("");
                  setPage(0);
                }}
              >
                Clear filters
              </Button>
              {selected.size > 0 && (
                <Button
                  variant="outline"
                  disabled={batchUncheckBusy}
                  onClick={() => {
                    setUncheckDialog({ type: "batch", ids: Array.from(selected) });
                  }}
                >
                  <UserMinus className="mr-2 h-4 w-4" />
                  Uncheck Selected ({selected.size})
                </Button>
              )}
            </>
          }
        />
        <CardContent className="p-0 pb-6 pt-0">
          <div className="overflow-x-auto px-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
                  </TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Parent</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-muted-foreground py-8 text-center">
                      Loading…
                    </TableCell>
                  </TableRow>
                )}
                {!loading && matchRows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-muted-foreground py-12 text-center">
                      No records found.
                    </TableCell>
                  </TableRow>
                )}
                {!loading &&
                  pagedRows.map((r) => {
                    const isMember = !!r.serve_team;
                    const name =
                      (r.children?.full_name ?? r.serve_team?.full_name ?? "").trim() || "—";
                    const childAge = r.children
                      ? displayChildAge({ birthday: r.children.birthday, age: r.children.age })
                      : null;
                    return (
                      <TableRow
                        key={r.id}
                        data-state={selected.has(r.id) ? "selected" : undefined}
                      >
                        <TableCell>
                          <Checkbox
                            checked={selected.has(r.id)}
                            onCheckedChange={() => toggleOne(r.id)}
                          />
                        </TableCell>
                        <TableCell>{r.attendance_date}</TableCell>
                        <TableCell>{r.attendance_time?.slice(0, 5)}</TableCell>
                        <TableCell className="font-medium">{name}</TableCell>
                        <TableCell>
                          {isMember ? (
                            <Badge className="bg-primary text-primary-foreground">Serve Team</Badge>
                          ) : r.children ? (
                            childAge !== null ? (
                              <Badge variant="secondary">{ageCategory(childAge).label}</Badge>
                            ) : (
                              <Badge variant="outline">—</Badge>
                            )
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell>{r.children?.parent_name ?? "—"}</TableCell>
                        <TableCell>{r.service_schedule}</TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          <Button
                            size="sm"
                            variant="ghost"
                            type="button"
                            aria-pressed
                            title="Checked in — click to remove"
                            disabled={uncheckBusyId === r.id}
                            onClick={() => setUncheckDialog({ type: "single", row: r })}
                            className="text-green-600 hover:bg-green-50 hover:text-green-700 dark:text-green-500 dark:hover:bg-green-950/40"
                          >
                            <CircleCheck className="h-4 w-4" strokeWidth={2.75} aria-hidden />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
              </TableBody>
            </Table>
          </div>
          <TablePageNavigator
            page={page}
            pageSize={LIST_PAGE_SIZE}
            totalItems={totalCount}
            onPageChange={setPage}
            loading={loading}
          />
        </CardContent>
      </Card>

      <Dialog
        open={!!uncheckDialog}
        onOpenChange={(open) => {
          if (!open && !uncheckActionBusy) setUncheckDialog(null);
        }}
      >
        <DialogContent
          onPointerDownOutside={(e) => {
            if (uncheckActionBusy) e.preventDefault();
          }}
          onEscapeKeyDown={(e) => {
            if (uncheckActionBusy) e.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {uncheckDialog?.type === "batch"
                ? `Uncheck ${uncheckDialog.ids.length} attendance(s)?`
                : "Uncheck attendance?"}
            </DialogTitle>
            <DialogDescription asChild>
              <div>
                {uncheckDialog?.type === "batch" ? (
                  <p>
                    This removes the selected check-in record
                    {uncheckDialog.ids.length === 1 ? "" : "s"} from attendance. Stats and lists
                    update right away.
                  </p>
                ) : uncheckDialog?.type === "single" ? (
                  <p>
                    Remove check-in for{" "}
                    <span className="font-medium text-foreground">
                      {(
                        uncheckDialog.row.children?.full_name ??
                        uncheckDialog.row.serve_team?.full_name ??
                        ""
                      ).trim() || "—"}
                    </span>{" "}
                    on {uncheckDialog.row.attendance_date} at{" "}
                    {uncheckDialog.row.attendance_time?.slice(0, 5) ?? "—"}, service{" "}
                    {uncheckDialog.row.service_schedule}.
                  </p>
                ) : null}
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              type="button"
              disabled={uncheckActionBusy}
              onClick={() => setUncheckDialog(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={uncheckActionBusy}
              onClick={() => {
                void runUncheckDialog();
              }}
            >
              Uncheck
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
