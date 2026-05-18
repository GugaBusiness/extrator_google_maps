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

// Get search history endpoint
app.get('/api/history', (req, res) => {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      return res.json([]);
    }
    const files = fs.readdirSync(DATA_DIR);
    const history = [];
    
    for (const file of files) {
      if (file.startsWith('leads_') && file.endsWith('.json')) {
        const filePath = path.join(DATA_DIR, file);
        const stats = fs.statSync(filePath);
        
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const leads = JSON.parse(content);
          if (Array.isArray(leads) && leads.length > 0) {
            const first = leads[0];
            const category = first.category || 'Geral';
            
            // Infer city from address (e.g. "... - Pinheiros, São Paulo - SP ...")
            let city = 'Geral';
            if (first.address) {
              const parts = first.address.split('-');
              if (parts.length >= 2) {
                city = parts[parts.length - 2].trim().replace(/\d/g, '');
              }
            }
            history.push({
              filename: file,
              timestamp: file.replace('leads_', '').replace('.json', ''),
              leadsCount: leads.length,
              title: `${category}`,
              subtitle: city,
              date: stats.mtime
            });
          }
        } catch (e) {
          // Skip corrupt files
        }
      }
    }
    
    // Sort by date descending
    history.sort((a, b) => new Date(b.date) - new Date(a.date));
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Load history endpoint
app.get('/api/history/load', (req, res) => {
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
    return res.status(404).json({ error: 'Arquivo histórico não encontrado.' });
  }

  try {
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const leads = JSON.parse(fileContent);
    const csvFilename = safeFilename.replace('.json', '.csv');
    res.json({
      leads,
      jsonFilename: safeFilename,
      csvFilename
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete history endpoint
app.delete('/api/history', (req, res) => {
  const filename = req.query.file;
  if (!filename) {
    return res.status(400).json({ error: 'Parâmetro "file" é obrigatório.' });
  }

  const safeFilename = path.basename(filename);
  if (!safeFilename.match(/^leads_\d+\.json$/)) {
    return res.status(400).json({ error: 'Nome de arquivo inválido.' });
  }

  const jsonPath = path.join(DATA_DIR, safeFilename);
  const csvPath = path.join(DATA_DIR, safeFilename.replace('.json', '.csv'));

  try {
    let deletedCount = 0;
    if (fs.existsSync(jsonPath)) {
      fs.unlinkSync(jsonPath);
      deletedCount++;
    }
    if (fs.existsSync(csvPath)) {
      fs.unlinkSync(csvPath);
      deletedCount++;
    }

    if (deletedCount === 0) {
      return res.status(404).json({ error: 'Nenhum arquivo encontrado para exclusão.' });
    }

    res.json({ success: true, message: 'Histórico excluído com sucesso.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Parallel Queue Test Endpoint (SaaS Queue Integration)
app.post('/api/scrape-queue', async (req, res) => {
  const { query, limit, userId, city } = req.body;

  if (!query) {
    return res.status(400).json({ error: 'Parâmetro "query" é obrigatório.' });
  }
  if (!userId) {
    return res.status(400).json({ error: 'ID do Usuário ("userId") é obrigatório para o SaaS.' });
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

    console.log(`[QUEUE] Busca enfileirada com sucesso. Job ID: ${job.id}, Search ID: ${search.id}`);
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

// Serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  console.log(`Abra o extrator em http://localhost:${PORT}`);
});
