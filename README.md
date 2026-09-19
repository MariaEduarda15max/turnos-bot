# Bot de Turnos por Telegram — MVP Mini

Versión reducida del MVP 4. Ver `SPEC.md` para el detalle completo de flujos, modelo de
datos y casos borde.

## Stack

- Telegram Bot API (webhook)
- Supabase (Postgres + Edge Functions + pg_cron)
- Deploy: Supabase CLI vía GitHub Actions

## Setup (objetivo: 15 minutos)

1. `npm install -g supabase` (o usar `npx supabase`)
2. `supabase init` (si no está inicializado) y `supabase link --project-ref <ref>`
3. Crear bot en Telegram con [@BotFather](https://t.me/BotFather), copiar el token
4. Variables de entorno (Supabase → Project Settings → Edge Functions → Secrets):
   - `TELEGRAM_BOT_TOKEN`
   - `ADMIN_TELEGRAM_ID`
5. `supabase db push` — aplica las migraciones (`supabase/migrations/`)
6. `supabase functions deploy telegram-webhook`
7. Configurar el webhook de Telegram apuntando a la URL de la función desplegada
8. Verificar que `pg_cron` esté habilitado en el proyecto (Database → Extensions)

## Estructura

```
supabase/
  migrations/       # schema SQL (versionado)
  functions/
    deno.json       # fmt + lint nativos de Deno
    telegram-webhook/
SPEC.md             # spec completa (flujos, datos, casos borde)
.vscode/            # extensiones y settings compartidos del equipo
```

## Estado del proyecto

- [ ] Migraciones aplicadas
- [ ] Webhook de Telegram configurado
- [ ] Flujo cliente (registro, pedir turno, mis turnos)
- [ ] Flujo administrador (comandos + avisos)
- [ ] Recordatorios (pg_cron)
- [ ] Pruebas de casos borde (Sección 4 de SPEC.md)
