const express = require('express');
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

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

// Global state to store the latest search data for instant download
let currentSearchData = [];

// Helper to escape CSV values
function escapeCSV(val) {
  let str = String(val === undefined || val === null ? '' : val).replace(/"/g, '""');
  if (str.includes(',') || str.includes('\n') || str.includes('\r') || str.includes('"')) {
    return `"${str}"`;
  }
  return str;
}

// Convert JSON array to CSV string
function convertToCSV(data) {
  const headers = ['Nome', 'Categoria', 'Telefone', 'Website', 'Endereço', 'Avaliação', 'Total Avaliações', 'Latitude', 'Longitude', 'Link do Maps'];
  const rows = data.map(item => [
    item.name || '',
    item.category || '',
    item.phone || '',
    item.website || '',
    item.address || '',
    item.rating || '',
    item.reviewsCount || '',
    item.lat || '',
    item.lng || '',
    item.url || ''
  ]);
  
  return [
    headers.map(escapeCSV).join(','),
    ...rows.map(row => row.map(escapeCSV).join(','))
  ].join('\r\n');
}

// SSE Scraping Endpoint
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

  sendEvent('status', { message: 'Iniciando navegador Chromium...' });

  let browser;
  try {
    browser = await chromium.launch({
      headless: headless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu'
      ]
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      locale: 'pt-BR'
    });

    const page = await context.newPage();
    
    // Fast resource blocking on main search page to save CPU/Memory
    await page.route('**/*', (route) => {
      const type = route.request().resourceType();
      if (['image', 'media', 'font'].includes(type)) {
        route.abort();
      } else {
        route.continue();
      }
    });
    
    // Direct navigation to Google Maps search URL
    const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
    sendEvent('status', { message: `Buscando por: "${query}"...` });
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    sendEvent('status', { message: 'Roolando feed para localizar resultados...' });

    // Handle scroll on the left panel (feed)
    let prevHeight = 0;
    let noChangeCount = 0;
    let itemsCount = 0;
    const maxScrollAttempts = 40;
    let attempts = 0;

    while (attempts < maxScrollAttempts) {
      // Find the feed selector
      const feedExists = await page.locator('div[role="feed"]').count();
      if (!feedExists) {
        // If no feed is found, wait a moment or check if single result loaded directly
        const isSingleResult = await page.locator('h1').count();
        if (isSingleResult > 0) {
          sendEvent('status', { message: 'Único resultado encontrado direto!' });
          break;
        }
        await page.waitForTimeout(1000);
        attempts++;
        continue;
      }

      // Scroll the container
      await page.evaluate(() => {
        const feed = document.querySelector('div[role="feed"]');
        if (feed) {
          feed.scrollBy(0, 1200);
        }
      });

      await page.waitForTimeout(1800);

      // Count listings
      itemsCount = await page.locator('a[href*="/maps/place/"]').count();
      sendEvent('status', { message: `Localizados ${itemsCount} estabelecimentos no feed...` });

      if (itemsCount >= limit) {
        sendEvent('status', { message: `Meta de ${limit} resultados atingida no feed!` });
        break;
      }

      // Check if we hit the bottom of the scroll list
      const currentHeight = await page.evaluate(() => {
        const feed = document.querySelector('div[role="feed"]');
        return feed ? feed.scrollHeight : 0;
      });

      if (currentHeight === prevHeight) {
        noChangeCount++;
        // If the scroll height doesn't change after 6 scroll attempts, we've likely hit the bottom
        if (noChangeCount >= 6) {
          sendEvent('status', { message: 'Fim dos resultados da busca atingido.' });
          break;
        }
      } else {
        noChangeCount = 0;
        prevHeight = currentHeight;
      }

      // Check for bottom-of-list message
      const endTextFound = await page.evaluate(() => {
        return document.body.innerText.includes("Você chegou ao fim da lista") || 
               document.body.innerText.includes("reached the end of the list");
      });
      if (endTextFound) {
        sendEvent('status', { message: 'Google confirmou o fim da lista de resultados.' });
        break;
      }

      attempts++;
    }

    // Extract all unique detail URLs
    const detailUrls = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href*="/maps/place/"]'));
      return links.map(link => link.href);
    });

    const uniqueUrls = [...new Set(detailUrls)].slice(0, limit);
    sendEvent('status', { message: `Extraindo detalhes de ${uniqueUrls.length} estabelecimentos...` });

    const leads = [];
    const CONCURRENCY_LIMIT = 4; // Run up to 4 parallel workers for up to 400% speed increase!
    let urlIndex = 0;

    async function scrapeWorker() {
      while (urlIndex < uniqueUrls.length) {
        const currentIndex = urlIndex++;
        const url = uniqueUrls[currentIndex];
        sendEvent('status', { message: `Extraindo (${currentIndex + 1}/${uniqueUrls.length}): Carregando dados...` });

        try {
          const detailPage = await context.newPage();
          
          // Fast resource blocking to accelerate detail page scrape
          await detailPage.route('**/*', (route) => {
            const req = route.request();
            const type = req.resourceType();
            const urlStr = req.url();
            
            // Block images, videos, fonts, stylesheets and standard tracking scripts
            if (['image', 'media', 'font', 'stylesheet'].includes(type) ||
                urlStr.includes('google-analytics') ||
                urlStr.includes('analytics.js') ||
                urlStr.includes('doubleclick') ||
                urlStr.includes('bat.bing.com')) {
              route.abort();
            } else {
              route.continue();
            }
          });

          // Open detail page with shorter timeout since resource blocking makes it instant
          await detailPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
          
          // Wait for title element (h1) to load with shorter timeout
          await detailPage.waitForSelector('h1', { timeout: 6000 }).catch(() => {});

          // Extract Title (Name)
          const name = await detailPage.locator('h1').first().innerText().catch(() => 'Nome Indisponível');

          // Extract Rating and Review Count
          const ratingData = await detailPage.evaluate(() => {
            const container = document.querySelector('div.F7nice');
            if (!container) return { rating: '', reviewsCount: '' };

            const ratingSpan = container.querySelector('span[aria-hidden="true"]');
            const rating = ratingSpan ? ratingSpan.innerText.trim() : '';

            const reviewsButton = container.querySelector('button[aria-label*="avalia"], span[aria-label*="avalia"]');
            let reviewsCount = '';
            if (reviewsButton) {
              const label = reviewsButton.getAttribute('aria-label') || reviewsButton.innerText;
              const match = label.match(/\d[\d\s.,]*/);
              if (match) {
                reviewsCount = match[0].replace(/[^\d]/g, '').trim();
              }
            }
            return { rating, reviewsCount };
          }).catch(() => ({ rating: '', reviewsCount: '' }));

          // Extract Category
          const category = await detailPage.evaluate(() => {
            const button = document.querySelector('button[jsaction*="pane.rating.category"]');
            if (button) return button.innerText.trim();
            const el = document.querySelector('.DkEaCc');
            if (el) return el.innerText.trim();
            return '';
          }).catch(() => '');

          // Extract Address
          let address = await detailPage.locator('button[data-item-id="address"]').first().innerText().catch(() => '');
          address = address.replace(/[\n\r]/g, ' ').replace(/\s+/g, ' ').trim();

          // Extract Website
          const website = await detailPage.locator('a[data-item-id="authority"]').first().getAttribute('href').catch(() => '');

          // Extract Phone
          let phone = await detailPage.locator('button[data-item-id^="phone:tel:"]').first().innerText().catch(() => '');
          phone = phone.replace(/[\n\r]/g, '').trim();

          // Parse Coordinates (Lat/Lng) from URL
          const pageUrl = detailPage.url();
          const coordMatch = pageUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
          const lat = coordMatch ? coordMatch[1] : '';
          const lng = coordMatch ? coordMatch[2] : '';

          const lead = {
            name,
            category,
            phone,
            website,
            address,
            rating: ratingData.rating,
            reviewsCount: ratingData.reviewsCount,
            lat,
            lng,
            url: pageUrl
          };

          leads.push(lead);
          sendEvent('lead', { lead, index: currentIndex + 1, total: uniqueUrls.length });
          
          await detailPage.close().catch(() => {});
        } catch (err) {
          console.error(`Erro ao extrair item ${currentIndex + 1}:`, err.message);
          sendEvent('status', { message: `Erro ao extrair detalhes do item ${currentIndex + 1}. Pulando...` });
        }
      }
    }

    // Launch workers concurrently
    const workers = [];
    const activeConcurrency = Math.min(CONCURRENCY_LIMIT, uniqueUrls.length);
    for (let w = 0; w < activeConcurrency; w++) {
      workers.push(scrapeWorker());
    }
    await Promise.all(workers);

    sendEvent('status', { message: 'Salvando arquivos extraídos...' });

    // Store in global state
    currentSearchData = leads;

    const timestamp = Date.now();
    const jsonFilename = `leads_${timestamp}.json`;
    const csvFilename = `leads_${timestamp}.csv`;

    const jsonPath = path.join(DATA_DIR, jsonFilename);
    const csvPath = path.join(DATA_DIR, csvFilename);

    // Save JSON
    fs.writeFileSync(jsonPath, JSON.stringify(leads, null, 2), 'utf-8');

    // Save CSV
    const csvContent = convertToCSV(leads);
    fs.writeFileSync(csvPath, csvContent, 'utf-8');

    sendEvent('complete', {
      total: leads.length,
      jsonFilename,
      csvFilename
    });

  } catch (error) {
    console.error('Erro na raspagem:', error);
    sendEvent('error', { message: error.message || 'Erro inesperado durante a extração.' });
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    res.end();
  }
});

// Download JSON endpoint
app.get('/api/download/json', (req, res) => {
  if (currentSearchData.length === 0) {
    return res.status(404).json({ error: 'Nenhum dado disponível para download. Faça uma busca primeiro.' });
  }
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="leads_google_maps.json"');
  res.send(JSON.stringify(currentSearchData, null, 2));
});

// Download CSV endpoint
app.get('/api/download/csv', (req, res) => {
  if (currentSearchData.length === 0) {
    return res.status(404).json({ error: 'Nenhum dado disponível para download. Faça uma busca primeiro.' });
  }
  const csvContent = convertToCSV(currentSearchData);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="leads_google_maps.csv"');
  res.send('\uFEFF' + csvContent); // Add UTF-8 BOM for Excel compatibility
});

// Serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  console.log(`Abra o extrator em http://localhost:${PORT}`);
});
