const supabase = require('./supabaseClient');

async function testSupabaseIntegration() {
  console.log('🤖 [SUPABASE TEST] Iniciando validação do banco de dados na nuvem...');

  const testEmail = `testuser_${Date.now()}@mapsminer.com`;
  const testPassword = 'SaaSPassword123!';
  let userId;
  let searchId;

  try {
    // ----------------------------------------------------
    // PASSO 1: Obter o ID do Usuário por argumento no terminal
    // ----------------------------------------------------
    userId = process.argv[2];
    
    if (!userId || userId.length < 32) {
      console.error('\n❌ [ERRO]: Por favor, informe um UUID de usuário válido do Supabase.');
      console.log('Exemplo de uso: node test_supabase.js e351edc6-0132-4236-a939-659ddb271f6d');
      return;
    }

    console.log(`✅ Usando Usuário ID: ${userId}`);

    // ----------------------------------------------------
    // PASSO 2: Verificar se o gatilho (Trigger) funcionou
    // ----------------------------------------------------
    console.log('\n2. Aguardando 2 segundos para o Trigger rodar e verificar perfil...');
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (profileError) {
      throw new Error(`Falha ao buscar perfil da tabela 'profiles' (O gatilho falhou?): ${profileError.message}`);
    }

    console.log('✅ Gatilho (Trigger) funcionou perfeitamente!');
    console.log('📊 Perfil criado automaticante no banco:', {
      id: profile.id,
      email: profile.email,
      credits: profile.credits,
      plan: profile.plan,
    });

    // ----------------------------------------------------
    // PASSO 3: Inserir um registro de busca
    // ----------------------------------------------------
    console.log('\n3. Criando uma busca de teste na tabela "searches"...');
    const { data: search, error: searchError } = await supabase
      .from('searches')
      .insert({
        user_id: userId,
        query: 'Dentista',
        city: 'Pinheiros, São Paulo - SP',
        limit_count: 5,
        status: 'completed',
        json_filename: `leads_test_${Date.now()}.json`,
        csv_filename: `leads_test_${Date.now()}.csv`
      })
      .select()
      .single();

    if (searchError) {
      throw new Error(`Falha ao criar registro de busca: ${searchError.message}`);
    }

    searchId = search.id;
    console.log(`✅ Busca registrada com sucesso! ID: ${searchId}`);

    // ----------------------------------------------------
    // PASSO 4: Inserir um lead de teste enriquecido
    // ----------------------------------------------------
    console.log('\n4. Inserindo um lead de teste enriquecido na tabela "leads"...');
    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .insert({
        search_id: searchId,
        name: 'Clínica Odonto Riso',
        category: 'Dentista',
        phone: '(11) 99999-8888',
        email: 'contato@odontoriso.com.br',
        website: 'https://odontoriso.com.br',
        instagram: 'https://instagram.com/odontoriso',
        facebook: 'https://facebook.com/odontoriso',
        linkedin: 'https://linkedin.com/company/odontoriso',
        youtube: '',
        address: 'Av. Rebouças, 1200 - Pinheiros, São Paulo - SP',
        rating: 4.8,
        reviews_count: 142,
        lat: '-23.5614',
        lng: '-46.6812',
        url: 'https://google.com/maps/place/odontoriso',
        has_whatsapp: true
      })
      .select()
      .single();

    if (leadError) {
      throw new Error(`Falha ao inserir lead de teste: ${leadError.message}`);
    }

    console.log(`✅ Lead inserido e validado com sucesso! ID: ${lead.id}`);

    console.log('\n🎉 [INTEGRAÇÃO CONCLUÍDA!] Seu Supabase está 100% pronto para rodar com o MapsMiner SaaS!');

  } catch (err) {
    console.error('\n❌ [ERRO DE VALIDAÇÃO]:', err.message);
  }
}

testSupabaseIntegration();
