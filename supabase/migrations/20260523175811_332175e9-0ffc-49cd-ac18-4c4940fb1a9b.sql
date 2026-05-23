ALTER TABLE public.children ALTER COLUMN full_name DROP NOT NULL;
ALTER TABLE public.children ALTER COLUMN age DROP NOT NULL;
ALTER TABLE public.children ALTER COLUMN parent_name DROP NOT NULL;
ALTER TABLE public.children ALTER COLUMN service_schedule DROP NOT NULL;