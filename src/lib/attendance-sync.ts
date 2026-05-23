/** Fired when attendance rows are added or removed so lists/stats can refetch. */
export const ATTENDANCE_CHANGED_EVENT = "vkc:attendance-changed";

export function broadcastAttendanceChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(ATTENDANCE_CHANGED_EVENT));
}
