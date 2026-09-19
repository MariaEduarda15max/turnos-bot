import { supabase } from "../lib/supabase.ts";
import { editMessageText, sendMessage } from "../lib/telegram.ts";

const DIAS_A_MOSTRAR = 14; // SPEC.md 1.2 — "próximos 14 días" [propuesto]
const ZONA_HORARIA = "America/Montevideo"; // SPEC.md 4.1 — fija, un solo negocio

// Uruguay no tiene horario de verano desde 2015: el offset es siempre -03:00.
// Sin este offset explícito, `new Date("2026-09-20T09:00")` se interpreta
// según la zona horaria del servidor (Deno en Supabase corre en UTC), lo
// que corría todos los horarios ~3hs — turnos guardados a una hora distinta
// de la que el cliente eligió. Toda fecha+hora "de pared" del negocio debe
// construirse con esta función, nunca con `new Date(string)` a secas.
export function fechaMontevideo(dia: string, horaHHMM: string): Date {
  // Postgres devuelve columnas `time` como "09:00:00" (con segundos), no
  // "09:00" — sin este recorte, pegarle ":00" fijo generaba una fecha
  // inválida ("...T09:00:00:00-03:00") y calcularSlotsLibres devolvía
  // silenciosamente cero horarios para cualquier día.
  const hora = horaHHMM.slice(0, 5);
  return new Date(`${dia}T${hora}:00-03:00`);
}

// --- Paso 1: elegir servicio ---------------------------------------------

export async function iniciarPedirTurno(chatId: number, telegramId: number) {
  const { data: servicios } = await supabase
    .from("servicios")
    .select("id, nombre")
    .eq("activo", true);

  if (!servicios || servicios.length === 0) {
    await sendMessage(chatId, "No hay servicios disponibles en este momento.");
    return;
  }

  await supabase
    .from("clientes")
    .update({ contexto_conversacion: { paso: "esperando_servicio" } })
    .eq("telegram_id", telegramId);

  await sendMessage(
    chatId,
    "¿Qué servicio querés reservar?",
    servicios.map((s) => [{ text: s.nombre, callback_data: `servicio:${s.id}` }]),
  );
}

// --- Paso 2: elegir día ----------------------------------------------------

export async function elegirServicio(
  chatId: number,
  messageId: number,
  telegramId: number,
  servicioId: string,
) {
  const dias = await diasConDisponibilidad(servicioId);

  if (dias.length === 0) {
    await editMessageText(chatId, messageId, "No hay días disponibles para ese servicio ahora mismo.");
    return;
  }

  await supabase
    .from("clientes")
    .update({ contexto_conversacion: { paso: "esperando_dia", servicio_id: servicioId } })
    .eq("telegram_id", telegramId);

  await editMessageText(
    chatId,
    messageId,
    "Elegí un día:",
    dias.map((d) => [{ text: formatearFecha(d), callback_data: `dia:${d}` }]),
  );
}

// Días de los próximos DIAS_A_MOSTRAR que tienen franja de disponibilidad
// configurada para ese día de la semana. No descarta acá los días sin
// horarios libres reales (eso se resuelve en el paso 3, con mensaje de
// "no hay horarios" y vuelta atrás — SPEC.md 1.2).
export async function diasConDisponibilidad(servicioId: string): Promise<string[]> {
  const { data: disponibilidad } = await supabase
    .from("disponibilidad")
    .select("dia_semana");

  const diasConFranja = new Set((disponibilidad ?? []).map((d) => d.dia_semana));
  const resultado: string[] = [];

  for (let i = 0; i < DIAS_A_MOSTRAR; i++) {
    const fecha = new Date();
    fecha.setDate(fecha.getDate() + i);
    // "sv-SE" da formato YYYY-MM-DD; con timeZone Montevideo evita que un
    // servidor en UTC calcule "hoy" con la fecha equivocada.
    const iso = fecha.toLocaleDateString("sv-SE", { timeZone: ZONA_HORARIA });
    // Se evalúa al mediodía (no medianoche) para no caer nunca del lado
    // equivocado del corte UTC↔Montevideo al pedir el día de la semana.
    const diaSemana = fechaMontevideo(iso, "12:00").getDay();
    if (diasConFranja.has(diaSemana)) {
      resultado.push(iso);
    }
  }
  return resultado;
}

export function formatearFecha(iso: string): string {
  const fecha = fechaMontevideo(iso, "00:00");
  return fecha.toLocaleDateString("es-UY", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: ZONA_HORARIA,
  });
}

// --- Paso 3: elegir horario -------------------------------------------------

export async function elegirDia(
  chatId: number,
  messageId: number,
  telegramId: number,
  servicioId: string,
  dia: string,
) {
  const slots = await calcularSlotsLibres(servicioId, dia);

  if (slots.length === 0) {
    // SPEC.md 1.2: no dejar callejón sin salida — se puede volver a elegir día.
    const dias = await diasConDisponibilidad(servicioId);
    await editMessageText(
      chatId,
      messageId,
      "No quedan horarios libres ese día. Probá con otro:",
      dias.map((d) => [{ text: formatearFecha(d), callback_data: `dia:${d}` }]),
    );
    return;
  }

  await supabase
    .from("clientes")
    .update({
      contexto_conversacion: { paso: "esperando_horario", servicio_id: servicioId, dia },
    })
    .eq("telegram_id", telegramId);

  await editMessageText(
    chatId,
    messageId,
    "Elegí un horario:",
    slots.map((s) => [{ text: s, callback_data: `horario:${s}` }]),
  );
}

export async function calcularSlotsLibres(
  servicioId: string,
  dia: string,
  excluirTurnoId?: string,
): Promise<string[]> {
  const [{ data: servicio }, { data: franjas }, { data: turnosDelDia }, { data: bloqueosDelDia }] =
    await Promise.all([
      supabase.from("servicios").select("duracion_min").eq("id", servicioId).single(),
      supabase
        .from("disponibilidad")
        .select("hora_desde, hora_hasta")
        .eq("dia_semana", fechaMontevideo(dia, "12:00").getDay()),
      (() => {
        let query = supabase
          .from("turnos")
          .select("id, inicio, duracion_min")
          .eq("estado", "confirmado")
          .gte("inicio", fechaMontevideo(dia, "00:00").toISOString())
          .lt("inicio", fechaMontevideo(dia, "23:59").toISOString());
        // Al reprogramar, el turno propio no debe bloquearse a sí mismo.
        if (excluirTurnoId) query = query.neq("id", excluirTurnoId);
        return query;
      })(),
      supabase.from("bloqueos").select("hora_desde, hora_hasta").eq("fecha", dia),
    ]);

  if (!servicio || !franjas) return [];
  const duracion = servicio.duracion_min;

  const ocupados = [
    ...(turnosDelDia ?? []).map((t) => ({
      desde: new Date(t.inicio),
      hasta: new Date(new Date(t.inicio).getTime() + t.duracion_min * 60_000),
    })),
    ...(bloqueosDelDia ?? []).map((b) => ({
      desde: fechaMontevideo(dia, b.hora_desde),
      hasta: fechaMontevideo(dia, b.hora_hasta),
    })),
  ];

  const libres: string[] = [];

  for (const franja of franjas) {
    let cursor = fechaMontevideo(dia, franja.hora_desde);
    const fin = fechaMontevideo(dia, franja.hora_hasta);

    while (cursor.getTime() + duracion * 60_000 <= fin.getTime()) {
      const cursorFin = new Date(cursor.getTime() + duracion * 60_000);
      const seSolapa = ocupados.some((o) => cursor < o.hasta && cursorFin > o.desde);

      if (!seSolapa && cursor.getTime() > Date.now()) {
        libres.push(
          cursor.toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", timeZone: ZONA_HORARIA }),
        );
      }
      cursor = cursorFin;
    }
  }

  return libres;
}

// --- Paso 4: confirmar turno -------------------------------------------------

export async function elegirHorario(
  chatId: number,
  messageId: number,
  telegramId: number,
  servicioId: string,
  dia: string,
  hora: string,
  adminChatId: number,
) {
  const { data: cliente } = await supabase
    .from("clientes")
    .select("id, nombre")
    .eq("telegram_id", telegramId)
    .single();

  const { data: servicio } = await supabase
    .from("servicios")
    .select("nombre, duracion_min")
    .eq("id", servicioId)
    .single();

  if (!cliente || !servicio) {
    await editMessageText(chatId, messageId, "Ocurrió un error, escribí /start de nuevo.");
    return;
  }

  const inicio = fechaMontevideo(dia, hora);

  const { error } = await supabase.from("turnos").insert({
    cliente_id: cliente.id,
    servicio_id: servicioId,
    inicio: inicio.toISOString(),
    duracion_min: servicio.duracion_min,
  });

  if (error) {
    // El constraint GiST anti-solapamiento (migración 0001) puede rechazar
    // el insert si alguien tomó ese horario en el instante entre elegir el
    // slot y confirmar. Es la carrera del caso borde 2 de la SPEC.
    await editMessageText(
      chatId,
      messageId,
      "Uy, justo se ocupó ese horario. Probá de nuevo con /start.",
    );
    return;
  }

  await supabase
    .from("clientes")
    .update({ contexto_conversacion: {} })
    .eq("telegram_id", telegramId);

  await editMessageText(
    chatId,
    messageId,
    `✅ Turno confirmado: ${servicio.nombre} el ${formatearFecha(dia)} a las ${hora}.`,
  );

  await sendMessage(
    adminChatId,
    `🆕 Nuevo turno: ${cliente.nombre} — ${servicio.nombre} — ${formatearFecha(dia)} ${hora}`,
  );
}