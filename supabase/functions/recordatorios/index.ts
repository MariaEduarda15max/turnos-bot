import { createClient } from "npm:@supabase/supabase-js@2";

const TELEGRAM_API = `https://api.telegram.org/bot${Deno.env.get("TELEGRAM_BOT_TOKEN")}`;
const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
const supabase = createClient(Deno.env.get("SUPABASE_URL")!, secretKeys.default);
const ZONA_HORARIA = "America/Montevideo";

async function enviarMensaje(chatId: number, texto: string) {
  const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: texto }),
  });
  if (!res.ok) console.error("Error enviando recordatorio:", await res.text());
}

Deno.serve(async (req) => {
  // Esta función no la llama Telegram — la dispara pg_cron cada 15 min.
  // Se valida un secret propio en el header en vez de --no-verify-jwt sin
  // ningún control, para que no cualquiera pueda disparar recordatorios
  // llamando a la URL a mano.
  const secretEsperado = Deno.env.get("CRON_SECRET");
  if (secretEsperado && req.headers.get("x-cron-secret") !== secretEsperado) {
    return new Response("no autorizado", { status: 401 });
  }

  // SPEC.md 1.4: ventana de 15 min (mismo intervalo del cron) para no
  // disparar el mismo turno dos veces ni dejar ninguno sin cubrir.
  const ahora = Date.now();
  const desde = new Date(ahora + 23.75 * 60 * 60 * 1000).toISOString(); // +23h45m
  const hasta = new Date(ahora + 24 * 60 * 60 * 1000).toISOString(); // +24h

  const { data: turnos, error } = await supabase
    .from("turnos")
    .select("id, inicio, clientes(telegram_id, nombre), servicios(nombre)")
    .eq("estado", "confirmado")
    .eq("recordatorio_enviado", false)
    .gte("inicio", desde)
    .lt("inicio", hasta);

  if (error) {
    console.error("Error consultando turnos para recordatorio:", error);
    return new Response("error", { status: 500 });
  }

  for (const turno of turnos ?? []) {
    const cliente = turno.clientes as unknown as { telegram_id: number; nombre: string };
    const servicio = turno.servicios as unknown as { nombre: string };
    const fechaHora = new Date(turno.inicio).toLocaleString("es-UY", {
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: ZONA_HORARIA,
    });

    await enviarMensaje(
      cliente.telegram_id,
      `⏰ Recordatorio: tenés turno de ${servicio.nombre} el ${fechaHora}.`,
    );

    // Se marca enviado apenas se manda, no al final del loop — si un envío
    // posterior del mismo lote falla, este ya quedó protegido de duplicados.
    await supabase.from("turnos").update({ recordatorio_enviado: true }).eq("id", turno.id);
  }

  return new Response(JSON.stringify({ procesados: turnos?.length ?? 0 }), {
    headers: { "content-type": "application/json" },
  });
});