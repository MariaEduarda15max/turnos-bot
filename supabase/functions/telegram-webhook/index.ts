import { supabase } from "./lib/supabase.ts";
import { answerCallbackQuery, editMessageText, sendMessage } from "./lib/telegram.ts";
import { handleRegistroTexto, handleStart, MENU_PRINCIPAL } from "./handlers/start.ts";
import { elegirDia, elegirHorario, elegirServicio, iniciarPedirTurno } from "./handlers/pedirTurno.ts";
import {
  confirmarCancelacion,
  elegirDiaReprogramacion,
  elegirHorarioReprogramacion,
  iniciarReprogramacion,
  listarMisTurnos,
  pedirConfirmacionCancelar,
} from "./handlers/misTurnos.ts";
import { comandoAgenda, comandoBloquear, comandoHoy, comandoListo, confirmarPedidoListo } from "./handlers/admin.ts";

const ADMIN_CHAT_ID = Number(Deno.env.get("ADMIN_TELEGRAM_ID"));

Deno.serve(async (req) => {
  const update = await req.json();

  try {
    if (update.message) {
      await procesarMensaje(update.message);
    } else if (update.callback_query) {
      await procesarCallback(update.callback_query);
    }
  } catch (err) {
    // Nunca dejar que un error interno tumbe la respuesta 200 — Telegram
    // reintenta el update si no responde 2xx, y eso puede duplicar acciones
    // (turnos, mensajes). Se loguea para debug y se responde OK igual.
    console.error("Error procesando update", err);
  }

  return new Response("ok");
});

async function procesarMensaje(message: {
  chat: { id: number };
  from: { id: number };
  text?: string;
}) {
  const chatId = message.chat.id;
  const telegramId = message.from.id;
  const texto = message.text?.trim() ?? "";

  if (texto === "/start") {
    await handleStart(chatId, telegramId);
    return;
  }

  // Comandos de administrador — solo responden si viene del chat del admin.
  if (chatId === ADMIN_CHAT_ID && texto.startsWith("/")) {
    const [comando, ...argumentos] = texto.split(/\s+/);

    if (comando === "/hoy") {
      await comandoHoy(chatId);
      return;
    }
    if (comando === "/agenda") {
      await comandoAgenda(chatId);
      return;
    }
    if (comando === "/bloquear") {
      await comandoBloquear(chatId, argumentos);
      return;
    }
    if (comando === "/listo") {
      await comandoListo(chatId);
      return;
    }
    // /start también puede tocarlo el admin (registro común) — no cae acá
    // porque ya fue capturado más arriba en esta misma función.
    await sendMessage(chatId, "Comandos disponibles: /hoy, /agenda, /bloquear, /listo");
    return;
  }

  const { data: cliente } = await supabase
    .from("clientes")
    .select("contexto_conversacion")
    .eq("telegram_id", telegramId)
    .maybeSingle();

  if (!cliente) {
    await sendMessage(chatId, "Escribí /start para registrarte primero.");
    return;
  }

  const contexto = cliente.contexto_conversacion as Record<string, unknown>;

  // Registro en curso (nombre/teléfono) — SPEC.md 1.1
  const consumidoPorRegistro = await handleRegistroTexto(chatId, telegramId, texto, contexto);
  if (consumidoPorRegistro) return;

  // Texto libre fuera de cualquier flujo — SPEC.md, caso borde 6.
  if (Object.keys(contexto).length === 0) {
    await sendMessage(chatId, "Usá los botones de arriba 👆", MENU_PRINCIPAL);
  }
}

async function procesarCallback(callbackQuery: {
  id: string;
  data: string;
  message: { chat: { id: number }; message_id: number };
  from: { id: number };
}) {
  await answerCallbackQuery(callbackQuery.id);

  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;
  const telegramId = callbackQuery.from.id;
  const [accion, valor] = callbackQuery.data.split(":");

  if (accion === "menu" && valor === "pedir_turno") {
    await iniciarPedirTurno(chatId, telegramId);
    return;
  }

  if (accion === "servicio") {
    await elegirServicio(chatId, messageId, telegramId, valor);
    return;
  }

  if (accion === "dia") {
    const { data: cliente } = await supabase
      .from("clientes")
      .select("contexto_conversacion")
      .eq("telegram_id", telegramId)
      .single();
    const servicioId = (cliente?.contexto_conversacion as Record<string, unknown>)?.servicio_id as string;
    await elegirDia(chatId, messageId, telegramId, servicioId, valor);
    return;
  }

  if (accion === "horario") {
    const { data: cliente } = await supabase
      .from("clientes")
      .select("contexto_conversacion")
      .eq("telegram_id", telegramId)
      .single();
    const contexto = cliente?.contexto_conversacion as Record<string, unknown>;
    await elegirHorario(
      chatId,
      messageId,
      telegramId,
      contexto.servicio_id as string,
      contexto.dia as string,
      valor,
      ADMIN_CHAT_ID,
    );
    return;
  }

  if (accion === "menu" && valor === "mis_turnos") {
    await listarMisTurnos(chatId, telegramId);
    return;
  }

  if (accion === "cancelar") {
    await pedirConfirmacionCancelar(chatId, messageId, valor);
    return;
  }

  if (accion === "cancelar_no") {
    await editMessageText(chatId, messageId, "Cancelación descartada.");
    return;
  }

  if (accion === "cancelar_si") {
    await confirmarCancelacion(chatId, messageId, valor, ADMIN_CHAT_ID);
    return;
  }

  if (accion === "reprogramar") {
    await iniciarReprogramacion(chatId, messageId, telegramId, valor);
    return;
  }

  if (accion === "dia_reprog") {
    const { data: cliente } = await supabase
      .from("clientes")
      .select("contexto_conversacion")
      .eq("telegram_id", telegramId)
      .single();
    const contexto = cliente?.contexto_conversacion as Record<string, unknown>;
    await elegirDiaReprogramacion(
      chatId,
      messageId,
      telegramId,
      contexto.servicio_id as string,
      contexto.turno_a_reprogramar as string,
      valor,
    );
    return;
  }

  if (accion === "horario_reprog") {
    const { data: cliente } = await supabase
      .from("clientes")
      .select("contexto_conversacion")
      .eq("telegram_id", telegramId)
      .single();
    const contexto = cliente?.contexto_conversacion as Record<string, unknown>;
    await elegirHorarioReprogramacion(
      chatId,
      messageId,
      telegramId,
      contexto.turno_a_reprogramar as string,
      contexto.dia as string,
      valor,
      ADMIN_CHAT_ID,
    );
    return;
  }

  if (accion === "listo") {
    await confirmarPedidoListo(chatId, valor);
    return;
  }
}