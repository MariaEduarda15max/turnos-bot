// Cliente delgado sobre la Telegram Bot API. Sin dependencias externas:
// Deno trae fetch nativo, no hace falta ningún SDK de Telegram.

const TELEGRAM_API = `https://api.telegram.org/bot${Deno.env.get("TELEGRAM_BOT_TOKEN")}`;

export interface InlineButton {
  text: string;
  callback_data: string;
}

async function call(method: string, payload: Record<string, unknown>) {
  const res = await fetch(`${TELEGRAM_API}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    // No tiramos excepción: un fallo de Telegram no debe tumbar el webhook
    // (Telegram reintenta si respondemos error, y no queremos duplicados).
    console.error("Telegram API error", method, await res.text());
  }
  return res.json();
}

export function sendMessage(
  chatId: number,
  text: string,
  buttons?: InlineButton[][],
) {
  return call("sendMessage", {
    chat_id: chatId,
    text,
    reply_markup: buttons ? { inline_keyboard: buttons } : undefined,
  });
}

export function answerCallbackQuery(callbackQueryId: string, text?: string) {
  return call("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
  });
}

// Edita el mensaje original en vez de mandar uno nuevo — así el wizard
// (servicio → día → horario) no deja un historial largo de mensajes viejos.
export function editMessageText(
  chatId: number,
  messageId: number,
  text: string,
  buttons?: InlineButton[][],
) {
  return call("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    reply_markup: buttons ? { inline_keyboard: buttons } : undefined,
  });
}
