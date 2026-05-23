export type ParsedChildPayload = {
  full_name: string | null;
  parent_name: string | null;
  birthday: string | null;
};
const MAXLEN = 100;

export function parseChildForm(form: HTMLFormElement): ParsedChildPayload | { error: string } {
  const fd = new FormData(form);
  const full_name_raw = fd.get("full_name");
  const parent_name_raw = fd.get("parent_name");
  const birthday_raw = fd.get("birthday");

  const full_name =
    typeof full_name_raw === "string" ? full_name_raw.trim().slice(0, MAXLEN) || null : null;
  const parent_name =
    typeof parent_name_raw === "string" ? parent_name_raw.trim().slice(0, MAXLEN) || null : null;

  let birthday: string | null = null;
  if (typeof birthday_raw === "string" && birthday_raw.trim() !== "") {
    const iso = birthday_raw.trim().slice(0, 10);
    const d = new Date(`${iso}T12:00:00`);
    if (isNaN(d.getTime())) return { error: "Invalid birthday" };
    birthday = iso;
  }

  return { full_name, parent_name, birthday };
}
