// Preencha com os dados do seu projeto Supabase:
//   Supabase → Project Settings → API Keys → URL do projeto e "Publishable key".
// A chave publicável pode ficar pública: quem protege os dados são as regras
// de acesso (RLS) criadas em supabase/schema.sql.
window.ACOMPANHAIR_CONFIG = {
  supabaseUrl: 'https://onbidvcfhrdjsybuqsuy.supabase.co',
  supabaseAnonKey: 'sb_publishable_Kac3upgjBc8YfszZokPm9A_VPhamoea',
  // Dias sem movimentação para um processo em andamento ser considerado "parado".
  diasParado: 15,
};
