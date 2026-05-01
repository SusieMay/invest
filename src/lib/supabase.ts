import { createClient } from '@supabase/supabase-js'

// Konfiguracja z zmiennych środowiskowych (Vite). Fallback na wartości
// domyślne pozostaje, aby nie zepsuć istniejącego deployu — docelowo
// ustaw VITE_SUPABASE_URL i VITE_SUPABASE_ANON_KEY w .env / w CI.
const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL ?? 'https://swrpjlcnkrkzbwrmezwf.supabase.co'
const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN3cnBqbGNua3JremJ3cm1lendmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1NTA3ODAsImV4cCI6MjA5MzEyNjc4MH0.SLf1LNn2NLmo8l0mldUBukiMnGLR7e_hgdN7X4AwDe0'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
