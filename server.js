const express = require('express');
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// Modern User-Agents for browser fingerprint rotation
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2.1 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0'
];

function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

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

// B2B Enrichment Helper: Scrapes website for emails and social media links
async function enrichLeadWebsite(url) {
  if (!url || typeof url !== 'string' || !url.startsWith('http')) {
    return { email: '', instagram: '', facebook: '', linkedin: '', youtube: '' };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000); // 6s timeout

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7'
      }
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return { email: '', instagram: '', facebook: '', linkedin: '', youtube: '' };
    }

    const html = await response.text();

    // Social Media Matches
    const instagramMatch = html.match(/href="([^"]*instagram\.com\/[^"]*)"/i) || html.match(/href='([^']*instagram\.com\/[^']*)'/i);
    const facebookMatch = html.match(/href="([^"]*facebook\.com\/[^"]*)"/i) || html.match(/href='([^']*facebook\.com\/[^']*)'/i);
    const linkedinMatch = html.match(/href="([^"]*linkedin\.com\/[^"]*)"/i) || html.match(/href='([^']*linkedin\.com\/[^']*)'/i);
    const youtubeMatch = html.match(/href="([^"]*youtube\.com\/[^"]*)"/i) || html.match(/href='([^']*youtube\.com\/[^']*)'/i);

    // Email Matches (mailto first, fallback to regex)
    const mailtoMatch = html.match(/mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
    let email = mailtoMatch ? mailtoMatch[1] : '';

    if (!email) {
      const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
      const allEmails = html.match(emailRegex);
      if (allEmails && allEmails.length > 0) {
        const filtered = allEmails.filter(e => {
          const lower = e.toLowerCase();
          return !lower.endsWith('.png') && !lower.endsWith('.jpg') && !lower.endsWith('.jpeg') && !lower.endsWith('.gif') && !lower.endsWith('.webp') && !lower.endsWith('example.com') && !lower.endsWith('sentry.io');
        });
        if (filtered.length > 0) {
          email = filtered[0];
        }
      }
    }

    const cleanSocial = (match) => {
      if (!match) return '';
      let socialUrl = match[1].trim();
      if (socialUrl.startsWith('//')) {
        socialUrl = 'https:' + socialUrl;
      } else if (!socialUrl.startsWith('http')) {
        socialUrl = 'https://' + socialUrl;
      }
      return socialUrl;
    };

    return {
      email: email.trim().toLowerCase(),
      instagram: cleanSocial(instagramMatch),
      facebook: cleanSocial(facebookMatch),
      linkedin: cleanSocial(linkedinMatch),
      youtube: cleanSocial(youtubeMatch)
    };

  } catch (err) {
    return { email: '', instagram: '', facebook: '', linkedin: '', youtube: '' };
  }
}


// Global state is no longer used for searches to support concurrent multi-user execution!

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
  const headers = ['Nome', 'Categoria', 'Telefone', 'Website', 'E-mail', 'Instagram', 'Facebook', 'LinkedIn', 'YouTube', 'Endereço', 'Avaliação', 'Total Avaliações', 'Latitude', 'Longitude', 'Link do Maps'];
  const rows = data.map(item => [
    item.name || '',
    item.category || '',
    item.phone || '',
    item.website || '',
    item.email || '',
    item.instagram || '',
    item.facebook || '',
    item.linkedin || '',
    item.youtube || '',
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

  const userAgent = getRandomUserAgent();

  let browser;
  try {
    const launchOptions = {
      headless: headless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu'
      ]
    };

    // Proxy support (optional via environment variables)
    if (process.env.PROXY_SERVER) {
      launchOptions.proxy = {
        server: process.env.PROXY_SERVER
      };
      if (process.env.PROXY_USERNAME && process.env.PROXY_PASSWORD) {
        launchOptions.proxy.username = process.env.PROXY_USERNAME;
        launchOptions.proxy.password = process.env.PROXY_PASSWORD;
      }
    }

    browser = await chromium.launch(launchOptions);

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: userAgent,
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

    const timestamp = Date.now();
    const jsonFilename = `leads_${timestamp}.json`;
    const csvFilename = `leads_${timestamp}.csv`;
    const jsonPath = path.join(DATA_DIR, jsonFilename);
    const csvPath = path.join(DATA_DIR, csvFilename);

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
            // Primary selector
            const container = document.querySelector('div.F7nice');
            if (container) {
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
            }

            // Fallback: search anywhere in page for rating/reviews
            const ratingEl = document.querySelector('span[aria-label*="estrelas"], span[aria-label*="stars"], span[aria-label*="avalia"]');
            if (ratingEl) {
              const label = ratingEl.getAttribute('aria-label') || '';
              const ratingMatch = label.match(/^(\d[.,]\d|\d)/);
              const rating = ratingMatch ? ratingMatch[1].replace(',', '.') : '';
              
              const reviewsMatch = label.match(/(\d[\d\s.,]*)\s*(avalia|review)/i);
              const reviewsCount = reviewsMatch ? reviewsMatch[1].replace(/[^\d]/g, '').trim() : '';
              return { rating, reviewsCount };
            }

            return { rating: '', reviewsCount: '' };
          }).catch(() => ({ rating: '', reviewsCount: '' }));

          // Extract Category
          const category = await detailPage.evaluate(() => {
            const button = document.querySelector('button[jsaction*="pane.rating.category"]');
            if (button) return button.innerText.trim();
            const el = document.querySelector('.DkEaCc');
            if (el) return el.innerText.trim();
            
            // Fallback
            const altEl = document.querySelector('button[class*="category"], span[class*="category"]');
            if (altEl) return altEl.innerText.trim();
            return '';
          }).catch(() => '');

          // Extract Address
          let address = '';
          const addressEl = await detailPage.locator('button[data-item-id="address"]').first().catch(() => null);
          if (addressEl) {
            address = await addressEl.innerText().catch(() => '');
          }
          
          if (!address) {
            // Fallback via SVG location-pin path detection
            address = await detailPage.evaluate(() => {
              const addressKeywords = ['M12 2C8.13 2 5', 'M12 8c-1.1', '12 2C'];
              const svgs = document.querySelectorAll('svg');
              for (const svg of svgs) {
                const paths = svg.querySelectorAll('path');
                for (const path of paths) {
                  const d = path.getAttribute('d') || '';
                  if (addressKeywords.some(k => d.includes(k))) {
                    let parent = svg.parentElement;
                    while (parent && parent.tagName !== 'BUTTON' && parent.tagName !== 'DIV' && parent.tagName !== 'A') {
                      parent = parent.parentElement;
                    }
                    if (parent && parent.innerText && parent.innerText.trim().length > 3) {
                      return parent.innerText.trim();
                    }
                  }
                }
              }
              return '';
            }).catch(() => '');
          }
          address = address.replace(/[\n\r]/g, ' ').replace(/\s+/g, ' ').trim();

          // Extract Website
          let website = await detailPage.locator('a[data-item-id="authority"]').first().getAttribute('href').catch(() => '');
          
          if (!website) {
            // Fallback via SVG globe/authority path detection
            website = await detailPage.evaluate(() => {
              const websiteKeywords = ['M12 2C6.48 2 2 6.48', 'M10 20v-6', 'M12 2C', '12 2C'];
              const svgs = document.querySelectorAll('svg');
              for (const svg of svgs) {
                const paths = svg.querySelectorAll('path');
                for (const path of paths) {
                  const d = path.getAttribute('d') || '';
                  if (websiteKeywords.some(k => d.includes(k))) {
                    let parent = svg.parentElement;
                    while (parent && parent.tagName !== 'A' && parent.tagName !== 'BUTTON') {
                      parent = parent.parentElement;
                    }
                    if (parent) {
                      if (parent.tagName === 'A' && parent.getAttribute('href')) {
                        return parent.getAttribute('href');
                      }
                      const link = parent.querySelector('a');
                      if (link && link.getAttribute('href')) {
                        return link.getAttribute('href');
                      }
                    }
                  }
                }
              }
              return '';
            }).catch(() => '');
          }

          // Extract Phone
          let phone = await detailPage.locator('button[data-item-id^="phone:tel:"]').first().innerText().catch(() => '');
          
          if (!phone) {
            // Fallback via SVG phone path detection
            phone = await detailPage.evaluate(() => {
              const phoneKeywords = ['M6.62', 'M20.01', 'M3.62', '10.79', 'M20 15.5c-1.2'];
              const svgs = document.querySelectorAll('svg');
              for (const svg of svgs) {
                const paths = svg.querySelectorAll('path');
                for (const path of paths) {
                  const d = path.getAttribute('d') || '';
                  if (phoneKeywords.some(k => d.includes(k))) {
                    let parent = svg.parentElement;
                    while (parent && parent.tagName !== 'BUTTON' && parent.tagName !== 'DIV' && parent.tagName !== 'A') {
                      parent = parent.parentElement;
                    }
                    if (parent && parent.innerText && parent.innerText.trim().length > 3) {
                      return parent.innerText.trim();
                    }
                  }
                }
              }
              return '';
            }).catch(() => '');
          }
          phone = phone.replace(/[\n\r]/g, '').trim();

          // Parse Coordinates (Lat/Lng) from URL
          const pageUrl = detailPage.url();
          const coordMatch = pageUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
          const lat = coordMatch ? coordMatch[1] : '';
          const lng = coordMatch ? coordMatch[2] : '';

          // Close detail page to immediately free browser memory
          await detailPage.close().catch(() => {});

          // Try to enrich B2B data (Email & Social Media) in background if website is available
          let b2bData = { email: '', instagram: '', facebook: '', linkedin: '', youtube: '' };
          if (website) {
            sendEvent('status', { message: `Verificando redes sociais e e-mails em: ${website}...` });
            b2bData = await enrichLeadWebsite(website);
          }

          const lead = {
            name,
            category,
            phone,
            website,
            email: b2bData.email,
            instagram: b2bData.instagram,
            facebook: b2bData.facebook,
            linkedin: b2bData.linkedin,
            youtube: b2bData.youtube,
            address,
            rating: ratingData.rating,
            reviewsCount: ratingData.reviewsCount,
            lat,
            lng,
            url: pageUrl
          };

          leads.push(lead);
          
          // Save progress incrementally so it is robust to cancellations
          fs.writeFileSync(jsonPath, JSON.stringify(leads, null, 2), 'utf-8');
          fs.writeFileSync(csvPath, convertToCSV(leads), 'utf-8');

          sendEvent('lead', { 
            lead, 
            index: currentIndex + 1, 
            total: uniqueUrls.length,
            jsonFilename,
            csvFilename
          });
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

    sendEvent('status', { message: 'Finalizando e salvando arquivos extraídos...' });

    // Save final JSON and CSV
    fs.writeFileSync(jsonPath, JSON.stringify(leads, null, 2), 'utf-8');
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

// Serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  console.log(`Abra o extrator em http://localhost:${PORT}`);
});
