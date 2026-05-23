import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TableToolbar } from "@/components/TableToolbar";
import { LIST_PAGE_SIZE, TablePageNavigator } from "@/components/TablePageNavigator";
import { toast } from "sonner";
import { Plus, QrCode, Pencil, Trash2, Download, Printer, Search } from "lucide-react";
import { QRCodeImage } from "@/components/QRCodeImage";
import { CsvImportExportMenu } from "@/components/CsvImportExportMenu";
import QRCode from "qrcode";
import { z } from "zod";
import {
  SUNDAY_SERVICES,
  DEFAULT_CHILD_ATTENDANCE_SERVICE,
  downloadCSV,
  ageFromBirthday,
  formatRegisteredDate,
  isChildrenOnlyAttendanceServiceSchedule,
} from "@/lib/utils-app";
import { AttendanceStats } from "@/components/AttendanceStats";

export const Route = createFileRoute("/_app/serve")({
  component: ServePage,
});

type Member = {
  id: string;
  full_name: string;
  birthday: string;
  service_schedule: string;
  created_at: string;
};

const schema = z.object({
  full_name: z.string().trim().min(1, "Name required").max(100),
  birthday: z.string().min(1, "Birthday required"),
  service_schedule: z.string().trim().min(1, "Service required").max(100),
});

const SERVICES = [...SUNDAY_SERVICES, "Friday 6:00 PM"];

function buildQR(m: Member) {
  return JSON.stringify({
    type: "member",
    id: m.id,
    full_name: m.full_name,
    birthday: m.birthday,
    service_schedule: m.service_schedule,
  });
}

function ServePage() {
  const [items, setItems] = useState<Member[]>([]);
  const [search, setSearch] = useState("");
  const [serviceFilter, setServiceFilter] = useState("");
  const [editing, setEditing] = useState<Member | null>(null);
  const [open, setOpen] = useState(false);
  const [qrFor, setQrFor] = useState<Member | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tablePage, setTablePage] = useState(0);
  const [statsDate, setStatsDate] = useState(() => new Date().toISOString().slice(0, 10));
  const load = async () => {
    const { data, error } = await supabase.from("serve_team").select("*").order("full_name");
    if (error) toast.error(error.message);
    else setItems((data ?? []) as Member[]);
    setSelected(new Set());
  };
  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    setTablePage(0);
  }, [search, serviceFilter]);

  const filtered = useMemo(
    () =>
      items.filter((m) => {
        const matchText = !search || m.full_name.toLowerCase().includes(search.toLowerCase());
        const matchService = !serviceFilter || m.service_schedule === serviceFilter;
        return matchText && matchService;
      }),
    [items, search, serviceFilter],
  );

  useEffect(() => {
    const last = Math.max(0, Math.ceil(filtered.length / LIST_PAGE_SIZE) - 1);
    if (tablePage > last) setTablePage(last);
  }, [filtered.length, tablePage]);

  const pageRows = useMemo(
    () => filtered.slice(tablePage * LIST_PAGE_SIZE, tablePage * LIST_PAGE_SIZE + LIST_PAGE_SIZE),
    [filtered, tablePage],
  );

  const allSelected = filtered.length > 0 && filtered.every((m) => selected.has(m.id));
  const toggleAll = () => {
    const next = new Set(selected);
    if (allSelected) filtered.forEach((m) => next.delete(m.id));
    else filtered.forEach((m) => next.add(m.id));
    setSelected(next);
  };
  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const handleSubmit = async (form: HTMLFormElement) => {
    const fd = new FormData(form);
    const parsed = schema.safeParse(Object.fromEntries(fd));
    if (!parsed.success) return toast.error(parsed.error.issues[0].message);
    if (editing) {
      const { error } = await supabase.from("serve_team").update(parsed.data).eq("id", editing.id);
      if (error) return toast.error(error.message);
      toast.success("Member updated");
    } else {
      const { error } = await supabase.from("serve_team").insert(parsed.data);
      if (error) return toast.error(error.message);
      toast.success("Member registered");
    }
    setOpen(false);
    setEditing(null);
    load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this member? This also removes their attendance.")) return;
    const { error } = await supabase.from("serve_team").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Deleted");
    load();
  };

  const handleBatchDelete = async () => {
    if (!selected.size) return;
    if (!confirm(`Delete ${selected.size} member(s)? This also removes their attendance.`)) return;
    const ids = Array.from(selected);
    const { error } = await supabase.from("serve_team").delete().in("id", ids);
    if (error) return toast.error(error.message);
    toast.success(`Deleted ${ids.length}`);
    load();
  };

  const exportCSV = () => {
    if (!filtered.length) return toast.info("Nothing to export");
    downloadCSV(
      `serve_team_${new Date().toISOString().slice(0, 10)}.csv`,
      filtered.map((m) => ({
        full_name: m.full_name,
        birthday: m.birthday,
        age: ageFromBirthday(m.birthday),
        service_schedule: m.service_schedule,
        registered: formatRegisteredDate(m.created_at),
      })),
    );
  };

  const importCSV = async (rows: Record<string, string>[]) => {
    const errors: string[] = [];
    const valid: z.infer<typeof schema>[] = [];
    rows.forEach((r, i) => {
      const sched = String(r.service_schedule ?? "");
      if (isChildrenOnlyAttendanceServiceSchedule(sched)) {
        errors.push(
          `Row ${i + 2}: Serve team can't use "${DEFAULT_CHILD_ATTENDANCE_SERVICE}" — that schedule is reserved for kids`,
        );
        return;
      }
      const parsed = schema.safeParse({
        full_name: r.full_name,
        birthday: r.birthday,
        service_schedule: r.service_schedule,
      });
      if (!parsed.success) errors.push(`Row ${i + 2}: ${parsed.error.issues[0].message}`);
      else valid.push(parsed.data);
    });
    if (!valid.length) return { inserted: 0, failed: rows.length, errors };
    const { error } = await supabase.from("serve_team").insert(valid);
    if (error) return { inserted: 0, failed: rows.length, errors: [error.message] };
    load();
    return { inserted: valid.length, failed: errors.length, errors };
  };

  const downloadQR = async (m: Member) => {
    const url = await QRCode.toDataURL(buildQR(m), { width: 600, margin: 2 });
    const a = document.createElement("a");
    a.href = url;
    a.download = `${m.full_name.replace(/\s+/g, "_")}_QR.png`;
    a.click();
  };

  const printQR = async (m: Member) => {
    const url = await QRCode.toDataURL(buildQR(m), { width: 600, margin: 2 });
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`
      <html><head><title>QR Badge - ${m.full_name}</title>
      <style>body{font-family:DM Sans,sans-serif;text-align:center;padding:24px}
      .card{border:2px solid #14498B;border-radius:16px;padding:24px;display:inline-block;max-width:340px}
      h1{color:#14498B;margin:8px 0;font-size:22px} p{margin:4px 0;color:#444}
      img{width:280px;height:280px}</style></head>
      <body><div class="card">
        <h1>Victory Church — Serve Team</h1>
        <img src="${url}" />
        <h2 style="margin:8px 0">${m.full_name}</h2>
        <p>Birthday: ${m.birthday}</p><p>${m.service_schedule}</p>
      </div><script>window.onload=()=>window.print()</script></body></html>`);
    w.document.close();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Serve Team</h1>
        <p className="text-muted-foreground mt-1">
          Register serve team members and generate QR badges.
        </p>
      </div>

      <AttendanceStats
        filter="member"
        title="Today's Serve Team Check-ins"
        statsDate={statsDate}
        onStatsDateChange={setStatsDate}
      />

      <Card className="overflow-hidden py-0 gap-0 shadow-sm">
        <TableToolbar
          primary={
            <>
              <div className="flex w-full flex-1 flex-wrap items-center gap-3">
                <div className="relative min-w-[200px] max-w-md flex-1">
                  <div className="relative">
                    <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none z-10" />
                    <Input
                      placeholder="Search by name…"
                      className="pl-9"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      aria-label="Search serve team"
                    />
                  </div>
                </div>
                <div className="w-full min-w-[140px] sm:w-auto sm:min-w-[160px]">
                  <Input
                    type="date"
                    value={statsDate}
                    onChange={(e) => setStatsDate(e.target.value)}
                    aria-label="Check-in stats date"
                  />
                </div>
                <div className="w-full min-w-[160px] sm:w-52">
                  <Select
                    value={serviceFilter || "__all__"}
                    onValueChange={(v) => setServiceFilter(v === "__all__" ? "" : v)}
                  >
                    <SelectTrigger aria-label="Filter by assigned service">
                      <SelectValue placeholder="All assigned services" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">All assigned services</SelectItem>
                      {SERVICES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto sm:justify-end">
                <CsvImportExportMenu
                  sampleHeaders={["full_name", "birthday", "service_schedule"]}
                  onImport={importCSV}
                  onExport={exportCSV}
                />
                <Dialog
                  open={open}
                  onOpenChange={(v) => {
                    setOpen(v);
                    if (!v) setEditing(null);
                  }}
                >
                  <DialogTrigger asChild>
                    <Button>
                      <Plus className="h-4 w-4 sm:mr-2" />
                      <span className="hidden sm:inline">Register Member</span>
                      <span className="sm:hidden">Add</span>
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>
                        {editing ? "Edit Member" : "Register Serve Team Member"}
                      </DialogTitle>
                    </DialogHeader>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        handleSubmit(e.currentTarget);
                      }}
                      className="space-y-4"
                    >
                      <div className="space-y-2">
                        <Label>Full Name</Label>
                        <Input name="full_name" required defaultValue={editing?.full_name} />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>Birthday</Label>
                          <Input
                            name="birthday"
                            type="date"
                            required
                            defaultValue={editing?.birthday}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Service Schedule</Label>
                          <Input
                            name="service_schedule"
                            list="serve-services"
                            required
                            defaultValue={editing?.service_schedule}
                            placeholder="Pick or type"
                          />
                          <datalist id="serve-services">
                            {SERVICES.map((s) => (
                              <option key={s} value={s} />
                            ))}
                          </datalist>
                        </div>
                      </div>
                      <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                          Cancel
                        </Button>
                        <Button type="submit">{editing ? "Save" : "Register"}</Button>
                      </DialogFooter>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>
            </>
          }
          footer={
            selected.size > 0 ? (
              <Button variant="destructive" onClick={handleBatchDelete}>
                <Trash2 className="h-4 w-4 mr-2" />
                Delete Selected ({selected.size})
              </Button>
            ) : null
          }
        />
        <CardContent className="p-0 pb-6 pt-0">
          <div className="overflow-x-auto px-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 text-center tabular-nums text-muted-foreground">
                    #
                  </TableHead>
                  <TableHead className="w-10">
                    <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
                  </TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Birthday</TableHead>
                  <TableHead>Age</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead className="whitespace-nowrap">Registered</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-12">
                      {items.length === 0 ? "No serve team members yet." : "No matches."}
                    </TableCell>
                  </TableRow>
                )}
                {pageRows.map((m, rowIdx) => {
                  const rowNum = tablePage * LIST_PAGE_SIZE + rowIdx + 1;
                  return (
                    <TableRow key={m.id} data-state={selected.has(m.id) ? "selected" : undefined}>
                      <TableCell
                        className="w-10 text-center tabular-nums text-muted-foreground text-xs"
                        title={m.id}
                      >
                        {rowNum}
                      </TableCell>
                      <TableCell>
                        <Checkbox
                          checked={selected.has(m.id)}
                          onCheckedChange={() => toggleOne(m.id)}
                        />
                      </TableCell>
                      <TableCell className="font-medium">{m.full_name}</TableCell>
                      <TableCell>{m.birthday}</TableCell>
                      <TableCell>{ageFromBirthday(m.birthday)}</TableCell>
                      <TableCell>{m.service_schedule}</TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">
                        {formatRegisteredDate(m.created_at)}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <Button size="sm" variant="ghost" onClick={() => setQrFor(m)}>
                          <QrCode className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditing(m);
                            setOpen(true);
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => handleDelete(m.id)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <TablePageNavigator
            page={tablePage}
            pageSize={LIST_PAGE_SIZE}
            totalItems={filtered.length}
            onPageChange={setTablePage}
          />
        </CardContent>
      </Card>

      <Dialog open={!!qrFor} onOpenChange={(v) => !v && setQrFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{qrFor?.full_name} — QR Badge</DialogTitle>
          </DialogHeader>
          {qrFor && (
            <div className="space-y-4">
              <div className="flex justify-center">
                <QRCodeImage value={buildQR(qrFor)} size={260} />
              </div>
              <div className="text-center text-sm text-muted-foreground">
                <div>
                  Birthday {qrFor.birthday} · Age {ageFromBirthday(qrFor.birthday)}
                </div>
                <div>{qrFor.service_schedule}</div>
              </div>
              <div className="flex gap-2 justify-center">
                <Button variant="outline" onClick={() => downloadQR(qrFor)}>
                  <Download className="h-4 w-4 mr-2" />
                  Download
                </Button>
                <Button onClick={() => printQR(qrFor)}>
                  <Printer className="h-4 w-4 mr-2" />
                  Print
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
