-- Serve team members
CREATE TABLE public.serve_team (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  birthday date NOT NULL,
  service_schedule text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.serve_team ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view serve_team"
  ON public.serve_team FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert serve_team"
  ON public.serve_team FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Staff can update serve_team"
  ON public.serve_team FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Staff can delete serve_team"
  ON public.serve_team FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

CREATE TRIGGER update_serve_team_updated_at
  BEFORE UPDATE ON public.serve_team
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Attendance: allow either a child or a serve team member
ALTER TABLE public.attendance ALTER COLUMN child_id DROP NOT NULL;
ALTER TABLE public.attendance ADD COLUMN member_id uuid REFERENCES public.serve_team(id) ON DELETE CASCADE;
ALTER TABLE public.attendance ADD CONSTRAINT attendance_one_subject
  CHECK ((child_id IS NOT NULL)::int + (member_id IS NOT NULL)::int = 1);
