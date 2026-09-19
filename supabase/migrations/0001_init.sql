-- MVP Mini · Turnos por Telegram
-- Ver SPEC.md secciones 3 y 4 para el razonamiento detrás de cada decisión.

create extension if not exists "btree_gist";
create extension if not exists "pgcrypto"; -- gen_random_uuid()

create type estado_turno as enum ('confirmado', 'cancelado', 'completado');
create type estado_pedido as enum ('pendiente', 'listo', 'entregado');

create table clientes (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint unique not null,
  nombre text not null,
  telefono text not null,
  creado_en timestamptz not null default now()
);

create table servicios (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  duracion_min int not null check (duracion_min > 0),
  activo boolean not null default true
);

create table disponibilidad (
  id uuid primary key default gen_random_uuid(),
  dia_semana int not null check (dia_semana between 0 and 6),
  hora_desde time not null,
  hora_hasta time not null,
  check (hora_desde < hora_hasta)
);

create table bloqueos (
  id uuid primary key default gen_random_uuid(),
  fecha date not null,
  hora_desde time not null,
  hora_hasta time not null,
  motivo text,
  check (hora_desde < hora_hasta)
);

-- Función auxiliar para el constraint anti-solapamiento de abajo.
-- Postgres exige que toda expresión usada en un índice (incluidos los de
-- "exclude using gist") esté marcada IMMUTABLE explícitamente — la
-- conversión "int || text)::interval" hecha inline no lo está a ojos de
-- Postgres, aunque en la práctica el resultado nunca cambia. Se resuelve
-- envolviéndola en una función propia. Ver discusión oficial:
-- postgresql.org/message-id/3C24671E-AA46-4B4D-965F-1F7F371F1F5E@justatheory.com
create function rango_turno(inicio timestamptz, duracion_min int)
returns tstzrange
language sql
immutable
as $$
  select tstzrange(inicio, inicio + (duracion_min || ' minutes')::interval)
$$;

create table turnos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id) on delete cascade,
  servicio_id uuid not null references servicios(id),
  inicio timestamptz not null,
  duracion_min int not null,
  estado estado_turno not null default 'confirmado',
  recordatorio_enviado boolean not null default false,
  -- Anti doble-reserva: ningún turno confirmado puede solaparse en el tiempo.
  -- Nota: usa un solo "recurso" (el negocio); si en el futuro hay varios
  -- profesionales en paralelo, agregar recurso_id a la exclusión.
  exclude using gist (
    rango_turno(inicio, duracion_min) with &&
  ) where (estado = 'confirmado')
);

create index idx_turnos_inicio on turnos (inicio);
create index idx_turnos_cliente on turnos (cliente_id);
create index idx_turnos_recordatorio on turnos (inicio) where recordatorio_enviado = false;

create table pedidos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id) on delete cascade,
  descripcion text not null,
  estado estado_pedido not null default 'pendiente',
  avisado_en timestamptz
);
