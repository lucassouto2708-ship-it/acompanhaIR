// Preencha com os dados do seu projeto Supabase:
//   Supabase → Project Settings → API → "Project URL" e "anon public" key.
// A chave "anon" pode ficar pública: quem protege os dados são as regras
// de acesso (RLS) criadas em supabase/schema.sql.
window.ACOMPANHAIR_CONFIG = {
  supabaseUrl: 'https://SEU-PROJETO.supabase.co',
  supabaseAnonKey: 'SUA-CHAVE-ANON-PUBLICA',
  // Dias sem movimentação para um processo em andamento ser considerado "parado".
  diasParado: 30,
};
