require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const { scrapeQueue } = require('./queue');
const { runScrape } = require('./scraperService');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Ensure data folder exists
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR);
}

// SSE Scraping Endpoint delegating to scraperService
app.get('/api/scrape', async (req, res) => {
  const query = req.query.query;
  const limit = parseInt(req.query.limit) || 10;
  const headless = req.query.headless !== 'false';

  if (!query) {
    res.status(400).json({ error: 'Parâmetro "query" é obrigatório.' });
    return;
  }

  // Set SSE Headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendEvent = (type, data) => {
    res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
  };

  try {
    await runScrape({
      query,
      limit,
      headless,
      onProgress: (type, data) => sendEvent(type, data)
    });
  } catch (error) {
    console.error('Erro na raspagem:', error);
    sendEvent('error', { message: error.message || 'Erro inesperado durante a extração.' });
  } finally {
    res.end();
  }
});

// Download JSON endpoint
app.get('/api/download/json', (req, res) => {
  const filename = req.query.file;
  if (!filename) {
    return res.status(400).json({ error: 'Parâmetro "file" é obrigatório.' });
  }

  const safeFilename = path.basename(filename);
  if (!safeFilename.match(/^leads_\d+\.json$/)) {
    return res.status(400).json({ error: 'Nome de arquivo inválido.' });
  }

  const filePath = path.join(DATA_DIR, safeFilename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Arquivo de download não encontrado.' });
  }

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
  
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  res.send(fileContent);
});

// Download CSV endpoint
app.get('/api/download/csv', (req, res) => {
  const filename = req.query.file;
  if (!filename) {
    return res.status(400).json({ error: 'Parâmetro "file" é obrigatório.' });
  }

  const safeFilename = path.basename(filename);
  if (!safeFilename.match(/^leads_\d+\.csv$/)) {
    return res.status(400).json({ error: 'Nome de arquivo inválido.' });
  }

  const filePath = path.join(DATA_DIR, safeFilename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Arquivo de download não encontrado.' });
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
  res.send('\uFEFF' + fs.readFileSync(filePath, 'utf-8')); // Add UTF-8 BOM for Excel compatibility
});

// Old redundant endpoints removed to prioritize secured routes.

// Public Configuration Endpoint (Supabase Credentials)
app.get('/api/config', (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY
  });
});

// Auth Middleware: Secure API routes using Supabase JWT
const authenticateUser = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token de autenticação ausente ou inválido.' });
  }

  const token = authHeader.split(' ')[1];
  const supabase = require('./supabaseClient');

  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      return res.status(401).json({ error: 'Sessão expirada ou inválida. Faça login novamente.' });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Erro ao validar token de autenticação: ' + err.message });
  }
};

// Get User Profile (Credits and Plan info) - Generates profile on the fly if missing!
app.get('/api/profile', authenticateUser, async (req, res) => {
  const supabase = require('./supabaseClient');
  try {
    let { data: profile, error } = await supabase
      .from('profiles')
      .select('credits, plan')
      .eq('id', req.user.id)
      .maybeSingle();

    if (error) {
      return res.status(500).json({ error: 'Erro ao conectar ao banco de dados: ' + error.message });
    }

    // Auto-create profile with 50 credits if not found (eliminates manual triggers requirement)
    if (!profile) {
      console.log(`[AUTH] Perfil não encontrado para ${req.user.email}. Criando perfil dinâmico com 50 créditos...`);
      const { data: newProfile, error: insertError } = await supabase
        .from('profiles')
        .insert({
          id: req.user.id,
          email: req.user.email,
          credits: 50,
          plan: 'free'
        })
        .select('credits, plan')
        .single();

      if (insertError) {
        console.error("[AUTH] Erro ao criar perfil dinâmico:", insertError.message);
        return res.status(500).json({ error: 'Erro ao criar perfil de usuário no banco de dados.' });
      }
      profile = newProfile;
    }

    res.json({
      email: req.user.email,
      credits: profile.credits,
      plan: profile.plan
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Parallel Queue Endpoint (SaaS Queue Integration) - Secured
app.post('/api/scrape-queue', authenticateUser, async (req, res) => {
  const { query, limit, city } = req.body;
  const userId = req.user.id; // Secure: taken from authenticated user token

  if (!query) {
    return res.status(400).json({ error: 'Parâmetro "query" é obrigatório.' });
  }

  const supabase = require('./supabaseClient');

  try {
    const targetLimit = parseInt(limit) || 10;
    const targetCity = city || 'Geral';

    // 1. Verificar créditos do perfil na nuvem
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('credits')
      .eq('id', userId)
      .single();

    if (profileError || !profile) {
      return res.status(404).json({ error: 'Perfil não encontrado ou falha de conexão: ' + (profileError?.message || '') });
    }

    if (profile.credits < targetLimit) {
      return res.status(403).json({
        error: `Créditos insuficientes. Você possui ${profile.credits} créditos, mas solicitou ${targetLimit} leads.`
      });
    }

    // 2. Criar a busca no Supabase com status 'processing'
    const { data: search, error: searchError } = await supabase
      .from('searches')
      .insert({
        user_id: userId,
        query: query,
        city: targetCity,
        limit_count: targetLimit,
        status: 'processing'
      })
      .select()
      .single();

    if (searchError || !search) {
      return res.status(500).json({ error: 'Falha ao registrar busca no Supabase: ' + (searchError?.message || '') });
    }

    // 3. Enfileirar tarefa no Redis + BullMQ
    const job = await scrapeQueue.add('scrape-job', {
      query,
      limit: targetLimit,
      userId,
      searchId: search.id
    });

    console.log(`[QUEUE] Busca enfileirada com sucesso para usuário ${userId}. Job ID: ${job.id}, Search ID: ${search.id}`);
    res.json({
      success: true,
      message: 'Tarefa de extração enfileirada com sucesso!',
      jobId: job.id,
      searchId: search.id,
      data: { query, limit: targetLimit }
    });
  } catch (err) {
    console.error('[QUEUE] Erro ao adicionar tarefa na fila:', err.message);
    res.status(500).json({ error: 'Erro interno ao enfileirar tarefa: ' + err.message });
  }
});

// Get queue search status and leads in real-time - Secured
app.get('/api/scrape-status/:searchId', authenticateUser, async (req, res) => {
  const { searchId } = req.params;
  const userId = req.user.id;
  const supabase = require('./supabaseClient');

  try {
    // 1. Obter status da busca garantindo que pertence ao usuário logado
    const { data: search, error: searchError } = await supabase
      .from('searches')
      .select('*')
      .eq('id', searchId)
      .eq('user_id', userId)
      .single();

    if (searchError || !search) {
      return res.status(404).json({ error: 'Busca não encontrada ou acesso não autorizado.' });
    }

    // 2. Obter leads já extraídos e gravados na nuvem para esta busca
    const { data: leads, error: leadsError } = await supabase
      .from('leads')
      .select('*')
      .eq('search_id', searchId)
      .order('created_at', { ascending: true });

    if (leadsError) {
      return res.status(500).json({ error: 'Erro ao obter leads: ' + leadsError.message });
    }

    res.json({
      status: search.status,
      jsonFilename: search.json_filename,
      csvFilename: search.csv_filename,
      leads: leads || []
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get authenticated user search history - Secured
app.get('/api/history', authenticateUser, async (req, res) => {
  const supabase = require('./supabaseClient');
  try {
    const { data: searches, error } = await supabase
      .from('searches')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Map searches to frontend history list item format
    const history = (searches || []).map(search => ({
      searchId: search.id,
      leadsCount: search.limit_count, // Fallback to limit_count
      title: search.query.split(' em ')[0] || search.query,
      subtitle: search.city || 'Geral',
      date: search.created_at,
      status: search.status,
      filename: search.json_filename || `leads_${search.id}.json`
    }));

    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Load history search with leads - Secured
app.get('/api/history/load', authenticateUser, async (req, res) => {
  const searchId = req.query.searchId || req.query.file?.replace('leads_', '')?.replace('.json', '');
  if (!searchId) {
    return res.status(400).json({ error: 'Parâmetro "searchId" ou "file" é obrigatório.' });
  }

  const supabase = require('./supabaseClient');
  try {
    // 1. Verificar propriedade da busca
    const { data: search, error: searchError } = await supabase
      .from('searches')
      .select('*')
      .eq('id', searchId)
      .eq('user_id', req.user.id)
      .single();

    if (searchError || !search) {
      return res.status(404).json({ error: 'Busca não encontrada ou acesso não autorizado.' });
    }

    // 2. Buscar leads da nuvem
    const { data: leads, error: leadsError } = await supabase
      .from('leads')
      .select('*')
      .eq('search_id', searchId)
      .order('created_at', { ascending: true });

    if (leadsError) {
      return res.status(500).json({ error: leadsError.message });
    }

    res.json({
      leads: leads || [],
      jsonFilename: search.json_filename || `leads_${search.id}.json`,
      csvFilename: search.csv_filename || `leads_${search.id}.csv`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete history search - Secured
app.delete('/api/history', authenticateUser, async (req, res) => {
  const searchId = req.query.searchId || req.query.file?.replace('leads_', '')?.replace('.json', '');
  if (!searchId) {
    return res.status(400).json({ error: 'Parâmetro "searchId" ou "file" é obrigatório.' });
  }

  const supabase = require('./supabaseClient');
  try {
    // 1. Verificar propriedade e deletar da nuvem (on delete cascade cuidará dos leads e histórico)
    const { data, error } = await supabase
      .from('searches')
      .delete()
      .eq('id', searchId)
      .eq('user_id', req.user.id)
      .select();

    if (error || !data || data.length === 0) {
      return res.status(404).json({ error: 'Nenhuma busca encontrada para exclusão ou acesso não autorizado.' });
    }

    // 2. Se houver arquivos locais deletados pelo scraper, limpá-los da VPS
    const safeFilename = `leads_${searchId}`;
    const jsonPath = path.join(DATA_DIR, safeFilename + '.json');
    const csvPath = path.join(DATA_DIR, safeFilename + '.csv');

    if (fs.existsSync(jsonPath)) fs.unlinkSync(jsonPath);
    if (fs.existsSync(csvPath)) fs.unlinkSync(csvPath);

    res.json({ success: true, message: 'Histórico excluído com sucesso.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  console.log(`Abra o extrator em http://localhost:${PORT}`);
});
