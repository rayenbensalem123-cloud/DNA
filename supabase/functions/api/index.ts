// Supabase Edge Function entry point: serves the whole /api/* of the Bureau d'Ordre.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided to every Edge Function automatically.
import { createHandler } from './handler.js';
import { createSupabaseStore, createSupabaseStorage } from './supabase.js';

const url = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const handler = createHandler({
  store: createSupabaseStore(url, serviceKey),
  storage: createSupabaseStorage(url, serviceKey),
});

Deno.serve((req: Request) => handler(req));
