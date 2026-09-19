import { createClient } from "npm:@supabase/supabase-js@2";

// Sistema nuevo de API keys de Supabase (proyectos creados desde nov. 2025
// ya no tienen service_role clásico). SUPABASE_SECRET_KEYS llega como JSON
// con una entrada por cada secret key creada en el dashboard — "default"
// es el nombre de la que se ve en Settings > API Keys > Secret keys.
// La función corre en el backend, no en el navegador del cliente final,
// así que no hay usuario autenticado que proteger acá con RLS.
const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");

export const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  secretKeys.default,
);
