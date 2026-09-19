import { supabase } from "../lib/supabase.ts";
import { sendMessage } from "../lib/telegram.ts";
import { fechaMontevideo } from "./pedirTurno.ts";

const ZONA_HORARIA = "America/Montevideo";

function formatearFechaHora(iso: string): string {
  const fecha = new Date(iso);
  return fecha.toLocaleString("es-UY", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: ZONA_HORARIA,
  });
}

// --- /hoy --------------------------------------------------------------

export async function comandoHoy(chatId: number) {
  const hoy = new Date().toLocaleDateString("sv-SE", { timeZone: ZONA_HORARIA }); // YYYY-MM-DD

  const { data: turnos } = await supabase
    .from("turnos")
    .select("inicio, clientes(nombre), servicios(nombre)")
    .eq("estado", "confirmado")
    .gte("inicio", fechaMontevideo(hoy, "00:00").toISOString())
    .lt("inicio", fechaMontevideo(hoy, "23:59").toISOString())
    .order("inicio");

  if (!turnos || turnos.length === 0) {
    await sendMessage(chatId, "No hay turnos para hoy.");
    return;
  }

  const lineas = turnos.map((t) => {
    const cliente = (t.clientes as unknown as { nombre: string })?.nombre ?? "?";
    const servicio = (t.servicios as unknown as { nombre: string })?.nombre ?? "?";
    const hora = new Date(t.inicio).toLocaleTimeString("es-UY", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: ZONA_HORARIA,
    });
    return `${hora} — ${cliente} (${servicio})`;
  });

  await sendMessage(chatId, `📅 Turnos de hoy:\n\n${lineas.join("\n")}`);
}

// --- /agenda -------------------------------------------------------------

export async function comandoAgenda(chatId: number) {
  const desde = new Date();
  const hasta = new Date();
  hasta.setDate(hasta.getDate() + 7);

  const { data: turnos } = await supabase
    .from("turnos")
    .select("inicio, clientes(nombre), servicios(nombre)")
    .eq("estado", "confirmado")
    .gte("inicio", desde.toISOString())
    .lt("inicio", hasta.toISOString())
    .order("inicio");

  if (!turnos || turnos.length === 0) {
    await sendMessage(chatId, "No hay turnos en los próximos 7 días.");
    return;
  }

  const lineas = turnos.map((t) => {
    const cliente = (t.clientes as unknown as { nombre: string })?.nombre ?? "?";
    const servicio = (t.servicios as unknown as { nombre: string })?.nombre ?? "?";
    return `${formatearFechaHora(t.inicio)} — ${cliente} (${servicio})`;
  });

  await sendMessage(chatId, `🗓️ Próximos 7 días:\n\n${lineas.join("\n")}`);
}

// --- /bloquear -------------------------------------------------------------

// Formato esperado: /bloquear 2026-09-20 14:00 18:00 [motivo opcional]
// [propuesto en SPEC.md 2] — no viene especificado en el brief original.
export async function comandoBloquear(chatId: number, argumentos: string[]) {
  const [fecha, horaDesde, horaHasta, ...motivoPartes] = argumentos;

  if (!fecha || !horaDesde || !horaHasta) {
    await sendMessage(
      chatId,
      "Formato: /bloquear AAAA-MM-DD HH:MM HH:MM [motivo]\nEj: /bloquear 2026-09-20 14:00 18:00 Feriado",
    );
    return;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !/^\d{2}:\d{2}$/.test(horaDesde) || !/^\d{2}:\d{2}$/.test(horaHasta)) {
    await sendMessage(chatId, "Formato de fecha u hora inválido. Usá AAAA-MM-DD y HH:MM.");
    return;
  }

  const { error } = await supabase.from("bloqueos").insert({
    fecha,
    hora_desde: horaDesde,
    hora_hasta: horaHasta,
    motivo: motivoPartes.join(" ") || null,
  });

  if (error) {
    console.error("Error creando bloqueo:", error);
    await sendMessage(chatId, "No pude crear el bloqueo. Revisá el formato.");
    return;
  }

  await sendMessage(chatId, `✅ Bloqueado ${fecha} de ${horaDesde} a ${horaHasta}.`);
}

// --- /listo ------------------------------------------------------------

export async function comandoListo(chatId: number) {
  const { data: pedidos } = await supabase
    .from("pedidos")
    .select("id, descripcion, clientes(nombre)")
    .eq("estado", "pendiente");

  if (!pedidos || pedidos.length === 0) {
    await sendMessage(chatId, "No hay pedidos pendientes.");
    return;
  }

  await sendMessage(
    chatId,
    "¿Qué pedido está listo?",
    pedidos.map((p) => {
      const cliente = (p.clientes as unknown as { nombre: string })?.nombre ?? "?";
      return [{ text: `${cliente} — ${p.descripcion}`, callback_data: `listo:${p.id}` }];
    }),
  );
}

export async function confirmarPedidoListo(chatId: number, pedidoId: string) {
  const { data: pedido, error } = await supabase
    .from("pedidos")
    .update({ estado: "listo", avisado_en: new Date().toISOString() })
    .eq("id", pedidoId)
    .select("descripcion, clientes(telegram_id, nombre)")
    .single();

  if (error || !pedido) {
    await sendMessage(chatId, "No pude marcar ese pedido como listo.");
    return;
  }

  const cliente = pedido.clientes as unknown as { telegram_id: number; nombre: string };
  await sendMessage(chatId, `✅ Avisado a ${cliente.nombre}.`);
  await sendMessage(cliente.telegram_id, `📦 ¡Tu pedido está listo para retirar! (${pedido.descripcion})`);
}