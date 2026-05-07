
DROP POLICY "Authenticated users can update children" ON public.children;
DROP POLICY "Authenticated users can delete children" ON public.children;
DROP POLICY "Authenticated users can delete attendance" ON public.attendance;

CREATE POLICY "Staff can update children" ON public.children
  FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Staff can delete children" ON public.children
  FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Staff can delete attendance" ON public.attendance
  FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);
