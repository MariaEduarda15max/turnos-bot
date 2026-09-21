# Bot de Turnos por Telegram — MVP Mini

Versión reducida del MVP 4, construida con método spec-driven development.
Ver `SPEC.md` para el detalle completo de flujos, modelo de datos y casos borde.

## Stack

- Telegram Bot API (webhook)
- Supabase (Postgres + Edge Functions en Deno + pg_cron + pg_net)
- Deploy: Supabase CLI (instalada como dependencia del proyecto, no global)

## Setup — objetivo 15 minutos

### 0. Prerrequisitos

Necesitás **Node.js y npm** instalados. Si `node --version` no te devuelve nada:

```bash
# Instalar Homebrew si no lo tenés (macOS)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
# Seguir las instrucciones que imprime al final para agregarlo al PATH,
# después:
brew install node
```

### 1. Instalar la CLI de Supabase (local al proyecto, no global)

```bash
npm install supabase --save-dev
```

> ⚠️ `npm install -g supabase` está deprecado por Supabase y falla a propósito.
> Todos los comandos de abajo van con `npx supabase ...`.

### 2. Crear el bot en Telegram

1. Hablale a [@BotFather](https://t.me/BotFather) en Telegram → `/newbot`.
2. Guardá el token que te da (formato `123456789:AAH...`).
3. Conseguí tu propio Telegram ID hablándole a `@userinfobot` — es el `ADMIN_TELEGRAM_ID`.

### 3. Crear el proyecto en Supabase

1. [supabase.com](https://supabase.com) → New Project → plan Free (sin tarjeta).
2. Guardá la contraseña de la base que pide al crearlo.

> **Nota sobre API keys:** proyectos creados desde nov. 2025 usan el sistema
> nuevo de keys (`sb_publishable_...` / `sb_secret_...`), no el `service_role`
> clásico. Este código ya está adaptado: lee `SUPABASE_SECRET_KEYS` (que
> Supabase inyecta solo) en vez de `SUPABASE_SERVICE_ROLE_KEY`. No hace falta
> copiar ninguna key a mano para la Edge Function — Supabase la inyecta.

### 4. Vincular y desplegar

```bash
npx supabase login
npx supabase link --project-ref TU_PROJECT_REF   # está en la URL del dashboard
npx supabase db push                              # aplica las 3 migraciones
npx supabase functions deploy telegram-webhook --no-verify-jwt
npx supabase functions deploy recordatorios --no-verify-jwt
```

### 5. Variables de entorno

Dashboard → Edge Functions → Secrets → agregar:

| Nombre | Valor |
|---|---|
| `TELEGRAM_BOT_TOKEN` | El token de BotFather |
| `ADMIN_TELEGRAM_ID` | Tu Telegram ID numérico |
| `CRON_SECRET` | Una cadena random propia (`openssl rand -hex 16`) |

Los nombres tienen que ser **exactos** — el código es sensible a mayúsculas/minúsculas.

### 6. Programar los recordatorios

Completar `supabase/migrations/0003_recordatorios_cron.sql` con el mismo
`CRON_SECRET` del paso anterior (reemplazar `<CRON_SECRET_AQUÍ>`), y:

```bash
npx supabase db push
```

Verificar que quedó programado, en el SQL Editor del dashboard:
```sql
select * from cron.job;
```

### 7. Cargar datos de prueba

SQL Editor del dashboard:
```sql
insert into servicios (nombre, duracion_min, activo) values ('Corte', 30, true);
insert into disponibilidad (dia_semana, hora_desde, hora_hasta)
values (1,'09:00','18:00'), (2,'09:00','18:00'), (3,'09:00','18:00'), (4,'09:00','18:00'), (5,'09:00','18:00');
```

### 8. Conectar el webhook de Telegram

```bash
curl "https://api.telegram.org/botTU_TOKEN/setWebhook?url=https://TU_PROJECT_REF.supabase.co/functions/v1/telegram-webhook"
```
Debería responder `{"ok":true,...}`.

### 9. Probar

Mandale `/start` al bot en Telegram y seguí el flujo. Ver logs en vivo desde
el dashboard → **Logs** (la CLI de Supabase, en esta versión, no tiene
subcomando `functions logs`).

## Estructura

```
supabase/
  migrations/
    0001_init.sql                    # schema: 6 tablas, tipos enum, constraint anti-solapamiento
    0002_add_contexto_conversacion.sql
    0003_recordatorios_cron.sql      # pg_cron + pg_net, dispara recordatorios cada 15 min
  functions/
    deno.json                        # fmt + lint nativos de Deno
    telegram-webhook/
      index.ts                       # router de mensajes y callback_query
      handlers/
        start.ts                     # registro (/start)
        pedirTurno.ts                # wizard servicio → día → horario
        misTurnos.ts                 # listar, cancelar, reprogramar
        admin.ts                     # /hoy, /agenda, /bloquear, /listo
      lib/
        telegram.ts                  # cliente delgado de la Bot API
        supabase.ts                  # cliente de Supabase (SUPABASE_SECRET_KEYS)
    recordatorios/
      index.ts                       # función separada, disparada por pg_cron
SPEC.md                              # spec completa (flujos, datos, casos borde)
.vscode/                             # extensiones y settings para Deno
```

## Zona horaria

Todo el negocio corre en `America/Montevideo` (UTC-3, fija, sin horario de
verano). Toda fecha "de pared" (elegida por un humano) se construye con la
función `fechaMontevideo()` en `pedirTurno.ts`, que agrega el offset
`-03:00` explícito — sin esto, el servidor de Supabase (que corre en UTC)
interpreta mal cualquier hora sin zona horaria adjunta.

## Estado del proyecto

- [x] Migraciones aplicadas
- [x] Webhook de Telegram configurado
- [x] Flujo cliente (registro, pedir turno, mis turnos, cancelar, reprogramar)
- [x] Flujo administrador (comandos + avisos automáticos)
- [x] Recordatorios (pg_cron cada 15 min)
- [x] Casos borde probados: mensaje fuera de flujo, turno pasado, doble
      reserva simultánea, `/bloquear` sobre turno confirmado
- [ ] Limpieza de datos de prueba antes de la demo

---

Hecho por **Maria Eduarda Da Rosa**