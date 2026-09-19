-- Recordatorios automáticos (SPEC.md 1.4). pg_cron dispara la Edge Function
-- `recordatorios` cada 15 minutos vía pg_net (HTTP desde Postgres).
--
-- IMPORTANTE — completar antes de correr esta migración:
--   1. Reemplazar <CRON_SECRET_AQUÍ> por una cadena aleatoria propia
--      (por ejemplo, generada con `openssl rand -hex 16`).
--   2. Cargar esa MISMA cadena como secret CRON_SECRET en
--      Edge Functions → Secrets, antes de invocar la función.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'enviar-recordatorios-turnos',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://znwhalsdzeyvrzvyxyru.supabase.co/functions/v1/recordatorios',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', 'ae0bae0249236a0cb9454896de0ea1d5'
    ),
    body := '{}'::jsonb
  );
  $$
);