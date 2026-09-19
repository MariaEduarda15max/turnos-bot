# SPEC — Bot de Turnos por Telegram (MVP Mini)

Método: spec-driven development. Esta spec se escribe completa antes de generar código.
Alcance: el del Bloque 02 del brief `NH-2026-INT-01`. Nada fuera de esto.

**Leyenda:** `[confirmado]` = viene literal del brief · `[propuesto]` = decisión de diseño mía para llenar un vacío del brief, sujeta a tu ajuste.

---

## 1. Flujos del cliente

### 1.1 `/start` — Registro `[confirmado]`

- Si `clientes.telegram_id` no existe → el bot pide nombre, luego teléfono, los guarda, confirma registro.
- Si `clientes.telegram_id` ya existe → **no vuelve a pedir nada** (el brief dice "una sola vez"). Responde con el menú principal directamente.
- `[propuesto]` Validación mínima de teléfono: debe tener al menos 8 dígitos. Si falla, se lo vuelve a pedir (sin loop infinito — máx. 3 intentos, después sugiere `/start` de nuevo).

### 1.2 Pedir turno `[confirmado]`

Wizard de 3 pasos con botones inline:

1. **Servicio** → lista `servicios` donde `activo = true`.
2. **Día** → `[propuesto]` próximos 14 días donde exista `disponibilidad` para ese `dia_semana` y no esté completamente cubierto por un `bloqueo`.
3. **Horario libre** → slots calculados a partir de `disponibilidad.hora_desde/hora_hasta` del día elegido, en incrementos de `servicios.duracion_min`, **excluyendo**:
   - horarios que se solapan con un `turno` existente en estado `confirmado`,
   - horarios que caen dentro de un `bloqueos`.

Al elegir horario → se crea `turno` (estado `confirmado`) → confirmación al cliente con fecha, hora, servicio → **aviso automático al administrador** (regla del Bloque 02: "cada turno nuevo... le llega al administrador al instante").

`[propuesto]` Si no hay horarios libres en un día, el bot lo indica y vuelve a ofrecer elegir otro día (no lo deja como callejón sin salida).

### 1.3 "Mis turnos" `[confirmado]`

- Lista turnos futuros del cliente (`turnos.inicio > now()`, estado `confirmado`), cada uno con botones **Cancelar** / **Reprogramar**.
- **Cancelar** → `[propuesto]` pide confirmación ("¿Seguro? Sí/No") antes de aplicar, para evitar cancelaciones por toque accidental de botón. Al confirmar: estado → `cancelado` + aviso al administrador.
- **Reprogramar** → `[propuesto]` reutiliza el wizard de "pedir turno" (día → horario) pero sobre el turno existente: al confirmar, actualiza `inicio` del mismo registro (no crea uno nuevo) y resetea `recordatorio_enviado = false`. Aviso al administrador.

### 1.4 Recordatorio automático `[confirmado]`

- 24 horas antes de `turnos.inicio`, para turnos en estado `confirmado` con `recordatorio_enviado = false`.
- Job corre cada 15 min (Bloque 03) → ventana de disparo: `inicio` entre `now() + 23h45m` y `now() + 24h`. `[propuesto]` esta ventana de 15 min evita duplicados sin necesitar lock; una vez enviado, `recordatorio_enviado = true` inmediatamente (idempotencia).

### 1.5 Aviso de pedido listo `[confirmado]`

- El admin marca un `pedido` como listo (`/listo`) → el cliente dueño de ese `pedido` recibe un mensaje. Al enviarse: `pedidos.estado = 'listo'`, `avisado_en = now()`.

---

## 2. Flujos del administrador `[confirmado]`

| Comando | Qué hace | Nota de implementación |
|---|---|---|
| `/hoy` | Turnos del día, nombre + hora + servicio | Filtra `turnos` por `inicio::date = today()`, estado `confirmado` |
| `/agenda` | Turnos de los próximos 7 días | Mismo filtro, rango de 7 días, agrupado por día |
| `/bloquear` | Bloquea día/horario | `[propuesto]` sintaxis: `/bloquear 2026-09-20 14:00 18:00 [motivo]`. Inserta en `bloqueos`. |
| `/listo` | Elige cliente y envía aviso de pedido listo | `[propuesto]` lista pedidos en estado `pendiente` con botones inline por cliente |
| Aviso automático | Turno nuevo / cancelación / reprogramación → notif. instantánea al admin | `[confirmado]` — sale de cualquiera de los 3 eventos del flujo cliente |

`[propuesto]` El `telegram_id` del administrador se guarda como variable de entorno (`ADMIN_TELEGRAM_ID`), no en una tabla — es un solo negocio, un solo admin, no justifica una tabla de roles.

---

## 3. Modelo de datos (Supabase / Postgres) `[confirmado + tipos propuestos]`

Las 6 tablas y campos principales son los del Bloque 02. Yo agrego tipos concretos y las máquinas de estado que el brief no especifica.

```sql
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
  duracion_min int not null,
  activo boolean not null default true
);

create table disponibilidad (
  id uuid primary key default gen_random_uuid(),
  dia_semana int not null check (dia_semana between 0 and 6), -- 0=domingo
  hora_desde time not null,
  hora_hasta time not null
);

create table bloqueos (
  id uuid primary key default gen_random_uuid(),
  fecha date not null,
  hora_desde time not null,
  hora_hasta time not null,
  motivo text
);

create table turnos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id),
  servicio_id uuid not null references servicios(id),
  inicio timestamptz not null,
  estado estado_turno not null default 'confirmado',
  recordatorio_enviado boolean not null default false
);

create table pedidos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id),
  descripcion text not null,
  estado estado_pedido not null default 'pendiente',
  avisado_en timestamptz
);

create index on turnos (inicio);
create index on turnos (cliente_id);
```

`[propuesto]` No incluí `reprogramado` como estado propio de `turnos`: reprogramar es "cancelar + crear" a nivel de negocio, pero a nivel de dato lo modelo como **update in place** del mismo registro (ver 1.3) para no perder el vínculo con el recordatorio ya calculado. Si preferís conservar historial de reprogramaciones, se puede agregar una tabla `turnos_historial` — lo marco como candidato a MVP 5, no bloquea el alcance actual.

---

## 4. Casos borde `[propuesto — no vienen en el brief, hay que decidirlos antes de codear]`

1. **Zona horaria:** todo en `America/Montevideo`, fija. Un solo negocio, no hay necesidad de manejar múltiples husos.
2. **Doble reserva simultánea:** dos clientes tocan el mismo horario casi al mismo tiempo → se resuelve con constraint de exclusión a nivel DB, no solo lógica de app:
   ```sql
   -- requiere btree_gist
   alter table turnos add constraint no_solape
     exclude using gist (servicio_id with =, tstzrange(inicio, inicio + interval '1 hour') with &&)
     where (estado = 'confirmado');
   ```
   (ajustar el intervalo según `duracion_min` real del servicio al insertar)
3. **Cancelar un turno ya pasado:** no debería aparecer en "Mis turnos" (el filtro `inicio > now()` ya lo excluye).
4. **`/bloquear` sobre un turno ya confirmado:** el bloqueo no cancela turnos existentes automáticamente — el admin lo hace a mano si hace falta. Evita cancelaciones silenciosas.
5. **Cliente que reprograma repetidamente:** sin límite en el MVP mini; se anota como posible abuso a controlar en MVP 5.
6. **Mensaje fuera de flujo** (cliente escribe texto libre en medio del wizard): el bot lo ignora con un mensaje corto tipo "Usá los botones de arriba 👆" — no hay IA conversacional (fuera de alcance).

---

## 5. Fuera de alcance `[confirmado]`

WhatsApp, pagos, multi-negocio, panel web, IA conversacional. Cualquier tentación de más → se anota para MVP 5, no se construye ahora.
