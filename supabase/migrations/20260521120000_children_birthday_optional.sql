-- Children: optional birthday; keep legacy/manual `age` (nullable); optional names; drop child service_schedule

BEGIN;

ALTER TABLE public.children DROP CONSTRAINT IF EXISTS children_age_check;

ALTER TABLE public.children ADD COLUMN IF NOT EXISTS birthday date;

-- Recover `age` if a bad earlier migration dropped it (values may be lost unless restored from backup)
ALTER TABLE public.children ADD COLUMN IF NOT EXISTS age integer;

ALTER TABLE public.children DROP CONSTRAINT IF EXISTS children_age_optional_chk;

ALTER TABLE public.children ALTER COLUMN age DROP NOT NULL;

ALTER TABLE public.children
  ADD CONSTRAINT children_age_optional_chk
  CHECK (age IS NULL OR (age >= 0 AND age <= 120));

ALTER TABLE public.children DROP COLUMN IF EXISTS service_schedule;

ALTER TABLE public.children ALTER COLUMN full_name DROP NOT NULL;
ALTER TABLE public.children ALTER COLUMN parent_name DROP NOT NULL;

COMMIT;
