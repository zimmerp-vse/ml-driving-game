import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

if (!url || !key) {
  // Shown in the console only; pages show a friendly message when calls fail.
  console.error('VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY is not set');
}

export const supabase = createClient(url ?? 'http://localhost', key ?? 'missing', {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'mlg-admin-auth' },
});
