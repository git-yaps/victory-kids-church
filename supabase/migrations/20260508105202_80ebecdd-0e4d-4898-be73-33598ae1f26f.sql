CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Remove existing job if rerun
DO $$ BEGIN
  PERFORM cron.unschedule('purge-old-attendance');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'purge-old-attendance',
  '0 2 * * *',
  $$ DELETE FROM public.attendance WHERE attendance_date < (CURRENT_DATE - INTERVAL '30 days'); $$
);