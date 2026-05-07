
-- Children table
CREATE TABLE public.children (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  age INTEGER NOT NULL CHECK (age >= 0 AND age <= 18),
  parent_name TEXT NOT NULL,
  service_schedule TEXT NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.children ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view children" ON public.children
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert children" ON public.children
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can update children" ON public.children
  FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete children" ON public.children
  FOR DELETE TO authenticated USING (true);

-- Attendance table
CREATE TABLE public.attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id UUID NOT NULL REFERENCES public.children(id) ON DELETE CASCADE,
  attendance_date DATE NOT NULL DEFAULT CURRENT_DATE,
  attendance_time TIME NOT NULL DEFAULT CURRENT_TIME,
  service_schedule TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'qr' CHECK (method IN ('qr','manual')),
  recorded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (child_id, attendance_date, service_schedule)
);

ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view attendance" ON public.attendance
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert attendance" ON public.attendance
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can delete attendance" ON public.attendance
  FOR DELETE TO authenticated USING (true);

CREATE INDEX idx_attendance_date ON public.attendance(attendance_date DESC);
CREATE INDEX idx_attendance_child ON public.attendance(child_id);
CREATE INDEX idx_children_name ON public.children(full_name);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER children_updated_at BEFORE UPDATE ON public.children
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
