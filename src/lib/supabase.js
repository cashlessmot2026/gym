import { createClient } from '@supabase/supabase-js'

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://bjctrivmobbilxvyopul.supabase.co'
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJqY3RyaXZtb2JiaWx4dnlvcHVsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY5NzgyMDUsImV4cCI6MjEwMjU1NDIwNX0.AGmAjy13WvD-Ng25_UNGqSCOxXIo99tX83g3goIr_Yo'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false }
})

/** Ejecuta una consulta y lanza el error si existe. */
export async function q(promise) {
  const { data, error } = await promise
  if (error) throw new Error(error.message)
  return data
}
