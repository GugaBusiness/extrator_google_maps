const { Worker } = require('bullmq');
const { redisConnection } = require('./queue');
const { runScrape } = require('./scraperService');
const supabase = require('./supabaseClient');

console.log('[WORKER] Inicializando o processador de fila BullMQ...');

// Inicializar o Worker que consome a fila 'scrape-queue'
const worker = new Worker('scrape-queue', async (job) => {
  console.log(`[WORKER] Iniciando processamento do Job #${job.id}`);
  console.log(`[WORKER] Dados recebidos: Query: "${job.data.query}", Limite: ${job.data.limit}, UserID: ${job.data.userId}, SearchID: ${job.data.searchId}`);

  const { query, limit, userId, searchId } = job.data;

  try {
    // Rodar o scraper real (modo headless=true para máxima economia no servidor)
    const result = await runScrape({
      query,
      limit,
      headless: true,
      userId,
      searchId,
      onProgress: async (type, data) => {
        // Atualiza o progresso do job no Redis para monitoramento
        await job.updateProgress({ type, ...data });
        console.log(`[WORKER] [Job #${job.id} Progresso]: ${type} - ${data.message || ''}`);
      }
    });

    const finalLeadsCount = result.leads.length;
    console.log(`[WORKER] [Job #${job.id}] Sucesso! Extraídos ${finalLeadsCount} leads. Atualizando Supabase...`);

    // 1. Atualizar a busca no Supabase para 'completed'
    await supabase
      .from('searches')
      .update({ status: 'completed' })
      .eq('id', searchId);

    // 2. Debitar créditos do perfil com base nos leads reais coletados
    if (userId && finalLeadsCount > 0) {
      const { data: profile, error: getProfileErr } = await supabase
        .from('profiles')
        .select('credits')
        .eq('id', userId)
        .single();

      if (profile && !getProfileErr) {
        const newCredits = Math.max(0, profile.credits - finalLeadsCount);
        await supabase
          .from('profiles')
          .update({ credits: newCredits })
          .eq('id', userId);
        console.log(`[WORKER] [Job #${job.id}] Débito de créditos: de ${profile.credits} para ${newCredits}`);
      }
    }

    return { success: true, processedLeads: finalLeadsCount };
  } catch (error) {
    console.error(`[WORKER] Erro ao processar Job #${job.id}:`, error.message);
    
    // Se houver falha crítica, marca a busca como 'failed' no Supabase
    if (searchId) {
      await supabase
        .from('searches')
        .update({ status: 'failed' })
        .eq('id', searchId);
    }

    throw error;
  }
}, {
  connection: redisConnection
});

worker.on('completed', (job, result) => {
  console.log(`[WORKER] Job #${job.id} concluído com sucesso. Resultado:`, result);
});

worker.on('failed', (job, err) => {
  console.error(`[WORKER] Job #${job.id} falhou criticamente. Motivo:`, err.message);
});

console.log('[WORKER] Ouvindo a fila "scrape-queue" no Redis...');
