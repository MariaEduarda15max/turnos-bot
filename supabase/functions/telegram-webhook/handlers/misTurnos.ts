import { supabase } from "../lib/supabase.ts";
import { editMessageText, sendMessage } from "../lib/telegram.ts";
import { calcularSlotsLibres, diasConDisponibilidad, fechaMontevideo, formatearFecha } from "./pedirTurno.ts";

// --- Listado ---------------------------------------------------------------

export async function listarMisTurnos(chatId: number, telegramId: number) {
  const { data: cliente } = await supabase
    .from("clientes")
    .select("id")
    .eq("telegram_id", telegramId)
    .single();

  if (!cliente) {
    await sendMessage(chatId, "Escribí /start para registrarte primero.");
    return;
  }

  const { data: turnos } = await supabase
    .from("turnos")
    .select("id, inicio, servicios(nombre)")
    .eq("cliente_id", cliente.id)
    .eq("estado", "confirmado")
    .gt("inicio", new Date().toISOString())
    .order("inicio");

  if (!turnos || turnos.length === 0) {
    await sendMessage(chatId, "No tenés turnos próximos.");
    return;
  }

  // Un mensaje por turno, cada uno con sus propios botones — más simple que
  // un único mensaje con N pares de botones y evita ambigüedad sobre a cuál
  // turno corresponde cada botón.
  for (const turno of turnos) {
    const fecha = new Date(turno.inicio);
    const servicioNombre = (turno.servicios as unknown as { nombre: string })?.nombre ?? "Servicio";
    const hora = fecha.toLocaleTimeString("es-UY", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "America/Montevideo",
    });
    await sendMessage(
      chatId,
      `${servicioNombre} — ${formatearFecha(turno.inicio.slice(0, 10))} a las ${hora}`,
      [
        [
          { text: "❌ Cancelar", callback_data: `cancelar:${turno.id}` },
          { text: "🔄 Reprogramar", callback_data: `reprogramar:${turno.id}` },
        ],
      ],
    );
  }
}

// --- Cancelar (con confirmación) --------------------------------------------

export async function pedirConfirmacionCancelar(
  chatId: number,
  messageId: number,
  turnoId: string,
) {
  await editMessageText(chatId, messageId, "¿Seguro que querés cancelar este turno?", [
    [
      { text: "Sí, cancelar", callback_data: `cancelar_si:${turnoId}` },
      { text: "No", callback_data: "cancelar_no" },
    ],
  ]);
}

export async function confirmarCancelacion(
  chatId: number,
  messageId: number,
  turnoId: string,
  adminChatId: number,
) {
  const { data: turno } = await supabase
    .from("turnos")
    .update({ estado: "cancelado" })
    .eq("id", turnoId)
    .select("inicio, clientes(nombre), servicios(nombre)")
    .single();

  if (!turno) {
    await editMessageText(chatId, messageId, "No pude cancelar ese turno (¿ya estaba cancelado?).");
    return;
  }

  await editMessageText(chatId, messageId, "Turno cancelado. ✅");

  const clienteNombre = (turno.clientes as unknown as { nombre: string })?.nombre ?? "Cliente";
  const servicioNombre = (turno.servicios as unknown as { nombre: string })?.nombre ?? "Servicio";
  await sendMessage(
    adminChatId,
    `❌ Cancelación: ${clienteNombre} — ${servicioNombre} — ${formatearFecha(turno.inicio.slice(0, 10))}`,
  );
}

// --- Reprogramar (reusa el wizard de día → horario) -------------------------

export async function iniciarReprogramacion(
  chatId: number,
  messageId: number,
  telegramId: number,
  turnoId: string,
) {
  const { data: turno } = await supabase
    .from("turnos")
    .select("servicio_id")
    .eq("id", turnoId)
    .single();

  if (!turno) {
    await editMessageText(chatId, messageId, "No encontré ese turno.");
    return;
  }

  const dias = await diasConDisponibilidad(turno.servicio_id);
  if (dias.length === 0) {
    await editMessageText(chatId, messageId, "No hay días disponibles para reprogramar ahora mismo.");
    return;
  }

  await supabase
    .from("clientes")
    .update({
      contexto_conversacion: {
        paso: "esperando_dia_reprogramacion",
        servicio_id: turno.servicio_id,
        turno_a_reprogramar: turnoId,
      },
    })
    .eq("telegram_id", telegramId);

  await editMessageText(
    chatId,
    messageId,
    "Elegí el nuevo día:",
    dias.map((d) => [{ text: formatearFecha(d), callback_data: `dia_reprog:${d}` }]),
  );
}

export async function elegirDiaReprogramacion(
  chatId: number,
  messageId: number,
  telegramId: number,
  servicioId: string,
  turnoId: string,
  dia: string,
) {
  const slots = await calcularSlotsLibres(servicioId, dia, turnoId);

  if (slots.length === 0) {
    const dias = await diasConDisponibilidad(servicioId);
    await editMessageText(
      chatId,
      messageId,
      "No quedan horarios libres ese día. Probá con otro:",
      dias.map((d) => [{ text: formatearFecha(d), callback_data: `dia_reprog:${d}` }]),
    );
    return;
  }

  await supabase
    .from("clientes")
    .update({
      contexto_conversacion: {
        paso: "esperando_horario_reprogramacion",
        servicio_id: servicioId,
        turno_a_reprogramar: turnoId,
        dia,
      },
    })
    .eq("telegram_id", telegramId);

  await editMessageText(
    chatId,
    messageId,
    "Elegí el nuevo horario:",
    slots.map((s) => [{ text: s, callback_data: `horario_reprog:${s}` }]),
  );
}

export async function elegirHorarioReprogramacion(
  chatId: number,
  messageId: number,
  telegramId: number,
  turnoId: string,
  dia: string,
  hora: string,
  adminChatId: number,
) {
  const inicio = fechaMontevideo(dia, hora);

  const { data: turno, error } = await supabase
    .from("turnos")
    // recordatorio_enviado vuelve a false: el turno cambió de horario, así
    // que el recordatorio de 24h debe recalcularse contra la nueva fecha.
    .update({ inicio: inicio.toISOString(), recordatorio_enviado: false })
    .eq("id", turnoId)
    .select("clientes(nombre), servicios(nombre)")
    .single();

  await supabase
    .from("clientes")
    .update({ contexto_conversacion: {} })
    .eq("telegram_id", telegramId);

  if (error || !turno) {
    // El constraint anti-solapamiento puede rechazar el update si ese
    // horario se ocupó justo en el medio (mismo caso borde que al pedir
    // turno nuevo — ver SPEC.md, caso borde 2).
    await editMessageText(chatId, messageId, "Uy, justo se ocupó ese horario. Probá de nuevo.");
    return;
  }

  await editMessageText(
    chatId,
    messageId,
    `✅ Turno reprogramado para el ${formatearFecha(dia)} a las ${hora}.`,
  );

  const clienteNombre = (turno.clientes as unknown as { nombre: string })?.nombre ?? "Cliente";
  const servicioNombre = (turno.servicios as unknown as { nombre: string })?.nombre ?? "Servicio";
  await sendMessage(
    adminChatId,
    `🔄 Reprogramación: ${clienteNombre} — ${servicioNombre} — nuevo horario ${formatearFecha(dia)} ${hora}`,
  );
}