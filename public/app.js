// ----------------------------------------------------
// MapsMiner Frontend Controller (Real-time SSE engine)
// ----------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements - Form & Controls
  const scrapeForm = document.getElementById('scrape-form');
  const queryInput = document.getElementById('search-query');
  const cityInput = document.getElementById('search-city');
  const limitInput = document.getElementById('search-limit');
  const headlessMode = document.getElementById('headless-mode');
  const btnStart = document.getElementById('btn-start');
  const btnStop = document.getElementById('btn-stop');
  const btnClearLogs = document.getElementById('btn-clear-logs');
  
  // DOM Elements - Terminal & Status
  const consoleLogs = document.getElementById('console-logs');
  const systemStatus = document.getElementById('system-status');
  const systemStatusText = systemStatus.querySelector('.status-text');
  const progressBarFill = document.getElementById('progress-bar-fill');
  const progressStatusText = document.getElementById('progress-status-text');
  const progressPercentVal = document.getElementById('progress-percent-val');
  
  // DOM Elements - Stats
  const statExtracted = document.getElementById('stat-extracted');
  const statPhones = document.getElementById('stat-phones');
  const statWebsites = document.getElementById('stat-websites');
  const statAvgRating = document.getElementById('stat-avg-rating');
  
  // DOM Elements - Export & Table
  const exportCard = document.getElementById('export-card');
  const downloadCsv = document.getElementById('download-csv');
  const downloadJson = document.getElementById('download-json');
  const tableFilter = document.getElementById('table-filter');
  const leadsTableBody = document.getElementById('leads-table-body');

  // Application State
  let eventSource = null;
  let allLeads = [];
  let scrapeActive = false;
  let activeJsonFilename = '';
  let activeCsvFilename = '';

  // Add line to terminal console
  function addLog(message, type = 'normal') {
    const time = new Date().toLocaleTimeString();
    const line = document.createElement('div');
    line.className = `log-line ${type}`;
    
    let prefix = '[LOG]';
    if (type === 'system') prefix = '[SISTEMA]';
    if (type === 'success') prefix = '[SUCESSO]';
    if (type === 'warning') prefix = '[ALERTA]';
    if (type === 'error') prefix = '[ERRO]';
    
    line.textContent = `${time} ${prefix} ${message}`;
    consoleLogs.appendChild(line);
    
    // Auto-scroll to bottom
    consoleLogs.scrollTop = consoleLogs.scrollHeight;
  }

  // Clear logs button
  btnClearLogs.addEventListener('click', () => {
    consoleLogs.innerHTML = '';
    addLog('Terminal limpo pelo operador.', 'system');
  });

  // Calculate and update stats counters
  function updateStats() {
    const total = allLeads.length;
    statExtracted.textContent = total;
    
    const withPhone = allLeads.filter(l => l.phone && l.phone.trim() !== '').length;
    statPhones.textContent = withPhone;
    
    const withWeb = allLeads.filter(l => l.website && l.website.trim() !== '').length;
    statWebsites.textContent = withWeb;
    
    const ratedLeads = allLeads.filter(l => l.rating && !isNaN(parseFloat(l.rating)));
    if (ratedLeads.length > 0) {
      const avg = ratedLeads.reduce((acc, curr) => acc + parseFloat(curr.rating), 0) / ratedLeads.length;
      statAvgRating.textContent = avg.toFixed(1);
    } else {
      statAvgRating.textContent = '0.0';
    }
  }

  // Add lead row to UI Table
  function appendLeadToTable(lead, index) {
    // Remove empty state row if first lead
    if (allLeads.length === 1) {
      leadsTableBody.innerHTML = '';
    }

    const row = document.createElement('tr');
    row.dataset.index = index;

    // Build phone cell with quick copy and WhatsApp link if exists
    let phoneContent = '<span class="text-muted">Não possui</span>';
    if (lead.phone) {
      const cleanNum = lead.phone.replace(/\D/g, '');
      const waNum = (cleanNum.length === 10 || cleanNum.length === 11) ? '55' + cleanNum : cleanNum;
      const message = encodeURIComponent(`Olá! Encontrei o seu contato no Google Maps.`);
      
      phoneContent = `
        <div class="phone-cell-wrapper">
          <span class="lead-phone">${lead.phone}</span>
          <div class="phone-actions">
            <button class="btn-copy-text" onclick="navigator.clipboard.writeText('${lead.phone}')" title="Copiar Telefone">
              <i class="fa-solid fa-copy"></i>
            </button>
            <a href="https://wa.me/${waNum}?text=${message}" target="_blank" class="btn-wa-direct" title="Iniciar Conversa no WhatsApp">
              <i class="fa-brands fa-whatsapp"></i>
            </a>
          </div>
        </div>
      `;
    }

    // Build email cell with quick copy and mailto link
    let emailContent = '<span class="text-muted">Não possui</span>';
    if (lead.email) {
      emailContent = `
        <div class="email-cell-wrapper">
          <a href="mailto:${lead.email}" class="lead-email-link" title="${lead.email}">
            <i class="fa-solid fa-envelope"></i> ${lead.email}
          </a>
          <button class="btn-copy-text" onclick="navigator.clipboard.writeText('${lead.email}')" title="Copiar E-mail">
            <i class="fa-solid fa-copy"></i>
          </button>
        </div>
      `;
    }

    // Build social media icons wrapper
    let socialsContent = '<div class="social-icons-wrapper">';
    let hasSocials = false;
    
    if (lead.instagram) {
      socialsContent += `
        <a href="${lead.instagram}" target="_blank" class="social-icon instagram" title="Instagram: ${lead.instagram}">
          <i class="fa-brands fa-instagram"></i>
        </a>
      `;
      hasSocials = true;
    }
    if (lead.facebook) {
      socialsContent += `
        <a href="${lead.facebook}" target="_blank" class="social-icon facebook" title="Facebook: ${lead.facebook}">
          <i class="fa-brands fa-facebook"></i>
        </a>
      `;
      hasSocials = true;
    }
    if (lead.linkedin) {
      socialsContent += `
        <a href="${lead.linkedin}" target="_blank" class="social-icon linkedin" title="LinkedIn: ${lead.linkedin}">
          <i class="fa-brands fa-linkedin"></i>
        </a>
      `;
      hasSocials = true;
    }
    if (lead.youtube) {
      socialsContent += `
        <a href="${lead.youtube}" target="_blank" class="social-icon youtube" title="YouTube: ${lead.youtube}">
          <i class="fa-brands fa-youtube"></i>
        </a>
      `;
      hasSocials = true;
    }
    
    if (!hasSocials) {
      socialsContent += '<span class="text-muted">-</span>';
    }
    socialsContent += '</div>';

    // Build website cell with quick copy if exists
    let websiteContent = '<span class="text-muted">Não possui</span>';
    if (lead.website) {
      const cleanWeb = lead.website.replace(/https?:\/\/(www\.)?/, '').substring(0, 18);
      websiteContent = `
        <div class="web-cell-wrapper">
          <a href="${lead.website}" target="_blank" class="lead-website-link" title="${lead.website}">
            <i class="fa-solid fa-arrow-up-right-from-square"></i> ${cleanWeb}...
          </a>
          <button class="btn-copy-text" onclick="navigator.clipboard.writeText('${lead.website}')" title="Copiar Site">
            <i class="fa-solid fa-copy"></i>
          </button>
        </div>
      `;
    }

    // Build address cell with quick copy if exists
    let addressContent = '<span class="text-muted">Não possui</span>';
    if (lead.address) {
      addressContent = `
        <div class="address-cell-wrapper">
          <span class="text-secondary" style="font-size: 13px;">${lead.address}</span>
          <button class="btn-copy-text" onclick="navigator.clipboard.writeText('${lead.address.replace(/'/g, "\\'")}')" title="Copiar Endereço">
            <i class="fa-solid fa-copy"></i>
          </button>
        </div>
      `;
    }

    // Build category badge if exists
    let categoryBadge = lead.category ? `<span class="lead-category">${lead.category}</span>` : '<span class="text-muted">-</span>';

    // Build rating badge if exists
    let ratingBadge = lead.rating ? `
      <div class="lead-rating-badge" title="${lead.reviewsCount || 0} avaliações">
        <i class="fa-solid fa-star"></i> ${lead.rating}
      </div>` : '<span class="text-muted">-</span>';

    row.innerHTML = `
      <td class="lead-index">${index}</td>
      <td><span class="lead-name">${lead.name}</span></td>
      <td>${categoryBadge}</td>
      <td>${phoneContent}</td>
      <td>${emailContent}</td>
      <td>${socialsContent}</td>
      <td>${websiteContent}</td>
      <td>${addressContent}</td>
      <td style="text-align: center;">${ratingBadge}</td>
      <td style="text-align: center;">
        <div class="lead-actions">
          <a href="${lead.url}" target="_blank" class="btn-action" title="Ver no Google Maps">
            <i class="fa-solid fa-map-location-dot"></i>
          </a>
        </div>
      </td>
    `;

    leadsTableBody.appendChild(row);
  }

  // Filter table rows on search input
  tableFilter.addEventListener('input', (e) => {
    const filterText = e.target.value.toLowerCase().trim();
    const rows = leadsTableBody.querySelectorAll('tr');
    
    if (rows.length === 0 || rows[0].classList.contains('empty-row')) return;

    rows.forEach(row => {
      const text = row.innerText.toLowerCase();
      if (text.includes(filterText)) {
        row.style.display = '';
      } else {
        row.style.display = 'none';
      }
    });
  });

  // Reset dashboard state
  function resetScrapeState() {
    allLeads = [];
    activeJsonFilename = '';
    activeCsvFilename = '';
    leadsTableBody.innerHTML = `
      <tr class="empty-row">
        <td colspan="10">
          <div class="empty-state">
            <i class="fa-solid fa-folder-open empty-icon"></i>
            <p>Nenhum lead extraído ainda. Defina os termos da busca acima e clique em "Iniciar Mineração"!</p>
          </div>
        </td>
      </tr>
    `;
    
    // Reset stats UI
    statExtracted.textContent = '0';
    statPhones.textContent = '0';
    statWebsites.textContent = '0';
    statAvgRating.textContent = '0.0';
    
    // Progress
    progressBarFill.style.width = '0%';
    progressPercentVal.textContent = '0%';
    progressStatusText.textContent = 'Aguardando mineração...';
    
    // Disable inputs
    tableFilter.value = '';
    tableFilter.disabled = true;
    exportCard.classList.remove('visible');
  }

  // Cancel/Stop scraping process
  function stopScrape() {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    
    scrapeActive = false;
    btnStart.disabled = false;
    btnStop.disabled = true;
    queryInput.disabled = false;
    cityInput.disabled = false;
    limitInput.disabled = false;
    headlessMode.disabled = false;
    
    systemStatus.className = 'status-badge';
    systemStatusText.textContent = 'Extração cancelada';
    
    addLog('Extração cancelada pelo operador.', 'warning');
    progressStatusText.textContent = 'Mineração interrompida.';
    
    // Enable export only if we collected some leads
    if (allLeads.length > 0) {
      exportCard.classList.add('visible');
      tableFilter.disabled = false;
      addLog(`Extração concluída parcialmente com ${allLeads.length} leads.`, 'success');
      
      downloadCsv.href = `/api/download/csv?file=${activeCsvFilename || `leads_${Date.now()}.csv`}`;
      downloadJson.href = `/api/download/json?file=${activeJsonFilename || `leads_${Date.now()}.json`}`;
    }
  }

  btnStop.addEventListener('click', stopScrape);

  // Form submission: Start Scraping!
  scrapeForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (scrapeActive) return;

    resetScrapeState();
    
    const niche = queryInput.value.trim();
    const city = cityInput.value.trim();
    const query = `${niche} em ${city}`;
    const limit = parseInt(limitInput.value) || 10;
    const headless = headlessMode.checked;

    if (!niche || !city) {
      addLog('Preencha o nicho e a cidade corretamente!', 'error');
      return;
    }

    // Set UI State
    scrapeActive = true;
    btnStart.disabled = true;
    btnStop.disabled = false;
    queryInput.disabled = true;
    cityInput.disabled = true;
    limitInput.disabled = true;
    headlessMode.disabled = true;
    
    systemStatus.className = 'status-badge active';
    systemStatusText.textContent = 'Extraindo...';
    progressStatusText.textContent = 'Iniciando navegador...';
    
    addLog(`Iniciando extração para: "${query}" (Limite: ${limit})`, 'system');

    // Connect to Server-Sent Events Endpoint
    const url = `/api/scrape?query=${encodeURIComponent(query)}&limit=${limit}&headless=${headless}`;
    eventSource = new EventSource(url);

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      switch (data.type) {
        case 'status':
          addLog(data.message, 'normal');
          progressStatusText.textContent = data.message;
          break;
          
        case 'lead':
          const lead = data.lead;
          allLeads.push(lead);
          
          // Capture active filenames
          if (data.jsonFilename) activeJsonFilename = data.jsonFilename;
          if (data.csvFilename) activeCsvFilename = data.csvFilename;
          
          // Append and update stats
          appendLeadToTable(lead, allLeads.length);
          updateStats();
          
          // Progress bar calc
          const currentProgressPercent = Math.min(100, Math.round((allLeads.length / limit) * 100));
          progressBarFill.style.width = `${currentProgressPercent}%`;
          progressPercentVal.textContent = `${currentProgressPercent}%`;
          
          addLog(`Lead minerado: [${allLeads.length}/${limit}] ${lead.name}`, 'success');
          break;
          
        case 'complete':
          addLog(`Extração concluída com sucesso! Total: ${data.total} leads.`, 'success');
          progressStatusText.textContent = 'Extração finalizada.';
          progressBarFill.style.width = '100%';
          progressPercentVal.textContent = '100%';
          
          systemStatus.className = 'status-badge done';
          systemStatusText.textContent = 'Concluído';
          
          // Setup download links
          const finalJson = data.jsonFilename || activeJsonFilename;
          const finalCsv = data.csvFilename || activeCsvFilename;
          downloadCsv.href = `/api/download/csv?file=${finalCsv}`;
          downloadJson.href = `/api/download/json?file=${finalJson}`;
          exportCard.classList.add('visible');
          tableFilter.disabled = false;
          
          // Cleanup
          eventSource.close();
          scrapeActive = false;
          btnStart.disabled = false;
          btnStop.disabled = true;
          queryInput.disabled = false;
          cityInput.disabled = false;
          limitInput.disabled = false;
          headlessMode.disabled = false;
          break;
          
        case 'error':
          addLog(`Erro de raspagem: ${data.message}`, 'error');
          progressStatusText.textContent = 'Erro durante a busca.';
          
          systemStatus.className = 'status-badge';
          systemStatusText.textContent = 'Erro na extração';
          
          eventSource.close();
          scrapeActive = false;
          btnStart.disabled = false;
          btnStop.disabled = true;
          queryInput.disabled = false;
          cityInput.disabled = false;
          limitInput.disabled = false;
          headlessMode.disabled = false;
          break;
      }
    };

    eventSource.onerror = (err) => {
      console.error('SSE Error:', err);
      addLog('A conexão com o servidor foi perdida ou interrompida.', 'error');
      stopScrape();
    };
  });
});
