-- QuickPull background timer: gathers eBay data for waiting cars every 5 minutes, even when nobody has the app open.
-- Before running:
--   1. Supabase → Database → Extensions: turn on "pg_cron" and "pg_net".
--   2. Replace YOUR-PROJECT-REF below with the part of your Project URL before ".supabase.co".
--   3. Replace YOUR-CRON-SECRET with the same text you saved as the CRON_SECRET secret.
-- Then paste this into SQL Editor and click Run.

select cron.unschedule('quickpull-gather') where exists (select 1 from cron.job where jobname = 'quickpull-gather');

select cron.schedule(
  'quickpull-gather',
  '*/5 * * * *',
  $$
  select net.http_post(
    url     := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/ebay-lookup',
    headers := '{"Content-Type": "application/json", "x-cron-secret": "YOUR-CRON-SECRET"}'::jsonb,
    body    := '{"action": "process"}'::jsonb,
    timeout_milliseconds := 150000
  );
  $$
);
