import { supabase } from "../lib/supabase.ts";
import { sendMessage } from "../lib/telegram.ts";

const MENU_PRINCIPAL: [{ text: string; callback_data: string }][] = [
  [{ text: "📅 Pedir turno", callback_data: "menu:pedir_turno" }],
  [{ text: "🗓️ Mis turnos", callback_data: "menu:mis_turnos" }],
];

// Contexto en memoria de "esperando teléfono" no persiste entre invocaciones
// del webhook (cada mensaje es una invocación nueva) — por eso el estado de
// "a mitad del registro" también vive en contexto_conversacion (SPEC.md 3.1),
// igual que el wizard de pedir turno.
export async function handleStart(chatId: number, telegramId: number) {
  const { data: existente } = await supabase
    .from("clientes")
    .select("id, nombre")
    .eq("telegram_id", telegramId)
    .maybeSingle();

  if (existente) {
    await sendMessage(chatId, `¡Hola de nuevo, ${existente.nombre}! 👋`, MENU_PRINCIPAL);
    return;
  }

  // Cliente nuevo: se crea el registro en estado "esperando nombre" y se
  // completa en los próximos mensajes de texto (ver handleTextoLibre).
  const { error } = await supabase.from("clientes").insert({
    telegram_id: telegramId,
    nombre: "",
    telefono: "",
    contexto_conversacion: { paso: "esperando_nombre" },
  });

  if (error) {
    // Antes esto se ignoraba en silencio: el bot igual pedía el nombre
    // aunque el cliente nunca quedara guardado, y el siguiente mensaje
    // fallaba con "no encontrado". Ahora se loguea (ver con
    // `supabase functions logs`) y se avisa al usuario en vez de fallar mudo.
    console.error("Error insertando cliente nuevo:", error);
    await sendMessage(chatId, "Hubo un error registrándote. Probá /start de nuevo en un momento.");
    return;
  }

  await sendMessage(chatId, "¡Bienvenido/a! ¿Cómo es tu nombre?");
}

export async function handleRegistroTexto(
  chatId: number,
  telegramId: number,
  texto: string,
  contexto: Record<string, unknown>,
): Promise<boolean> {
  // Devuelve true si el mensaje fue consumido por el flujo de registro.
  if (contexto.paso === "esperando_nombre") {
    const nombre = texto.trim();
    if (nombre.length < 2) {
      await sendMessage(chatId, "Ese nombre parece muy corto, ¿podés escribirlo de nuevo?");
      return true;
    }
    await supabase
      .from("clientes")
      .update({ nombre, contexto_conversacion: { paso: "esperando_telefono", nombre } })
      .eq("telegram_id", telegramId);
    await sendMessage(chatId, `Gracias, ${nombre}. Ahora pasame tu teléfono 📱`);
    return true;
  }

  if (contexto.paso === "esperando_telefono") {
    const telefono = texto.replace(/\s+/g, "");
    const intentos = (contexto.intentos as number) ?? 0;

    if (!/^\+?\d{8,}$/.test(telefono)) {
      if (intentos >= 2) {
        await supabase
          .from("clientes")
          .update({ contexto_conversacion: {} })
          .eq("telegram_id", telegramId);
        await sendMessage(chatId, "No pude validar ese número. Escribí /start para reintentar.");
        return true;
      }
      await supabase
        .from("clientes")
        .update({ contexto_conversacion: { ...contexto, intentos: intentos + 1 } })
        .eq("telegram_id", telegramId);
      await sendMessage(chatId, "Ese teléfono no parece válido (mínimo 8 dígitos). Probá de nuevo:");
      return true;
    }

    await supabase
      .from("clientes")
      .update({ telefono, contexto_conversacion: {} })
      .eq("telegram_id", telegramId);
    await sendMessage(chatId, "¡Listo, quedaste registrado! ✅", MENU_PRINCIPAL);
    return true;
  }

  return false;
}

export { MENU_PRINCIPAL };