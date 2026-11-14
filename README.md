# 📅 turnos-bot — Reservas de turnos por Telegram

Bot de Telegram para que los clientes de un negocio reserven, consulten, cancelen y reprogramen turnos, y para que el administrador vea su agenda desde el mismo chat. Versión mini del MVP 4 de NeverHype, construida con **spec-driven development**.

Hecho por **Maria Eduarda Da Rosa**

---

## ¿Qué hace?

**Cliente**
- `/start`: se registra una sola vez (nombre + teléfono validado). Si ya existe, va directo al menú.
- **Pedir turno**: servicio → día → horario libre, todo con botones inline. Recibe confirmación al instante.
- **Mis turnos**: lista sus turnos futuros con **Cancelar** (con confirmación) y **Reprogramar**.
- **Recordatorio automático** 24 h antes del turno.
- **Aviso de pedido listo** cuando el administrador lo marca.

**Administrador**
- `/hoy` y `/agenda` (próximos 7 días).
- `/bloquear 2026-09-20 14:00 18:00 motivo` para cerrar horarios.
- `/listo` para avisar a un cliente que su pedido está listo.
- Notificación instantánea de cada turno nuevo, cancelación o reprogramación.

## Cómo funciona

```
Telegram ──webhook──▶ Edge Function (Deno/TS) ──▶ Postgres (Supabase)
                           ▲                            │
                           │                            │ pg_cron (cada 15 min)
                     función recordatorios ◀── pg_net ──┘
```

1. Telegram envía cada mensaje o toque de botón por **webhook** a una Edge Function de Supabase.
2. La función enruta según el tipo de update (comando, texto, `callback_query`) hacia un handler: `start`, `pedirTurno`, `misTurnos` o `admin`.
3. **El estado de la conversación vive en la base**, en `clientes.contexto_conversacion` (jsonb). Cada mensaje es una invocación nueva y sin memoria, así que el paso del wizard (`esperando_servicio` → `esperando_dia` → `esperando_horario`) se guarda y se lee en cada interacción.
4. Los horarios libres se calculan a partir de `disponibilidad`, restando turnos confirmados y `bloqueos`, en saltos de `duracion_min`.
5. Un job de `pg_cron` llama cada 15 minutos, vía `pg_net`, a la función `recordatorios`, que busca turnos confirmados dentro de la ventana de 24 h y marca `recordatorio_enviado = true` (idempotente). Se autentica con el header `x-cron-secret`.

## Decisiones de diseño

| Decisión | Por qué |
|---|---|
| **Constraint de exclusión GiST** en `turnos` | Evita la doble reserva a nivel de base de datos, incluso con dos clientes tocando el mismo horario a la vez. La lógica de la app sola no alcanza ante una carrera. |
| Función `rango_turno()` **IMMUTABLE** | Postgres no permite casts no inmutables dentro de una exclusión. El wrapper permite usar `inicio` + `duracion_min` como rango. |
| Estado del wizard en jsonb | Las Edge Functions no comparten memoria entre invocaciones. |
| Zona horaria fija `America/Montevideo` | Un solo negocio; fechas siempre con offset explícito para evitar corrimientos de horas. |
| Reprogramar = update del mismo registro | Conserva el vínculo con el recordatorio, que se resetea. |
| Fallos de Telegram no tumban el webhook | Si respondiéramos error, Telegram reintentaría y generaría duplicados. |
| `/bloquear` no cancela turnos existentes | Evita cancelaciones silenciosas; el admin decide. |

## Stack

- **Telegram Bot API** (webhook, sin SDK: `fetch` nativo de Deno)
- **Supabase**: Postgres, Edge Functions (Deno + TypeScript), `pg_cron`, `pg_net`
- **Supabase CLI** para migraciones y deploy

## Estructura

```
SPEC.md                         # spec completa (flujos, datos, casos borde)
supabase/
  migrations/
    0001_init.sql               # 6 tablas + anti-solapamiento
    0002_add_contexto_conversacion.sql
    0003_recordatorios_cron.sql # job pg_cron + pg_net
  functions/
    telegram-webhook/
      index.ts                  # router de updates
      handlers/                 # start, pedirTurno, misTurnos, admin
      lib/                      # cliente Telegram y cliente Supabase
    recordatorios/index.ts      # envío de recordatorios 24 h antes
```

## Modelo de datos

`clientes`, `servicios`, `disponibilidad`, `bloqueos`, `turnos`, `pedidos`. Detalle y máquinas de estado en `SPEC.md`.

## Setup

1. `npx supabase login` y `npx supabase link --project-ref <ref>`
2. Crear el bot con [@BotFather](https://t.me/BotFather) y copiar el token.
3. Cargar secrets en Supabase: `TELEGRAM_BOT_TOKEN`, `ADMIN_TELEGRAM_ID`, `CRON_SECRET`.
4. `npx supabase db push` para aplicar las migraciones.
5. Desplegar: `npx supabase functions deploy telegram-webhook --no-verify-jwt` y lo mismo con `recordatorios`. (`--no-verify-jwt` porque Telegram no envía JWT.)
6. Apuntar el webhook de Telegram a la URL de la función (`setWebhook`).

> Nunca subas tokens ni claves al repositorio.

## Cómo se construyó

1. **Spec primero.** Antes de escribir código se redactó `SPEC.md`, marcando cada punto como `[confirmado]` (viene del brief) o `[propuesto]` (decisión de diseño).
2. **Base de datos.** Migraciones versionadas con las reglas de negocio en el esquema.
3. **Flujo cliente**, luego **flujo admin**, luego **recordatorios**.
4. **Pruebas de casos borde** de la sección 4 de la spec: doble reserva, turno pasado, texto fuera de flujo, bloqueos, reprogramaciones.
5. **Bugs reales resueltos:** API keys nuevas de Supabase (`SUPABASE_SECRET_KEYS`), desfase horario de 3 h, horarios duplicados por filas repetidas, columna faltante entre dos copias de la migración.

El código fue escrito con asistencia de Claude a partir de mis decisiones de producto; yo ejecuté, probé y verifiqué cada etapa.

## Evolución

El siguiente paso es [`turnos-web`](https://github.com/MariaEduarda15max/turnos-web): versión web multi-negocio con panel para el negocio y reserva pública para clientes.

---

## Para GitHub (About)

**Description**
> Bot de Telegram para reservar, cancelar y reprogramar turnos, con agenda y avisos para el administrador. Supabase + Edge Functions + pg_cron.

**Topics**
`telegram-bot` `supabase` `typescript` `deno` `edge-functions` `postgresql` `pg-cron` `appointment-scheduling` `spec-driven-development` `chatbot`
