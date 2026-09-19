-- Corrige un desfasaje: la migración 0001 se aplicó sin esta columna por un
-- error mío al preparar el archivo corregido del bug de IMMUTABLE. El código
-- (registro y wizard de turnos, ver SPEC.md 3.1) depende de ella.
alter table clientes
  add column if not exists contexto_conversacion jsonb not null default '{}'::jsonb;