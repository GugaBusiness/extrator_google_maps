const supabase = require('./supabaseClient');

async function checkProfiles() {
  console.log('🔍 [DEBUG profiles] Buscando todos os registros na tabela profiles...');
  
  const { data, error } = await supabase
    .from('profiles')
    .select('*');

  if (error) {
    console.error('❌ Erro ao buscar perfis:', error.message);
    return;
  }

  console.log(`📊 Total de perfis encontrados: ${data.length}`);
  if (data.length > 0) {
    console.log('📋 Perfis registrados:', JSON.stringify(data, null, 2));
  } else {
    console.log('⚠️ A tabela public.profiles está completamente vazia!');
  }
}

checkProfiles();
