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

  // DOM Elements - User Profile Header
  const userProfileHeader = document.getElementById('user-profile-header');
  const userEmailSpan = document.getElementById('user-email');
  const userCreditsSpan = document.getElementById('user-credits');
  const userPlanSpan = document.getElementById('user-plan');
  const btnLogout = document.getElementById('btn-logout');

  // Application State
  let supabaseClient = null;
  let userSession = null;
  let eventSource = null;
  let allLeads = [];
  let scrapeActive = false;
  let activeJsonFilename = '';
  let activeCsvFilename = '';

  // Initialize Supabase Auth and session checking
  async function initAuth() {
    try {
      const res = await fetch('/api/config');
      if (!res.ok) throw new Error('Não foi possível obter chaves do Supabase.');
      const config = await res.json();
      
      supabaseClient = supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);

      // Check current session
      const { data: { session } } = await supabaseClient.auth.getSession();
      if (!session) {
        window.location.href = '/login.html';
        return;
      }

      userSession = session;

      // Listen for auth state changes (e.g. sign out)
      supabaseClient.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT' || !session) {
          window.location.href = '/login.html';
        }
      });

      // Load Profile & History
      await loadUserProfile();
      loadSearchHistory();
    } catch (err) {
      console.error('Erro de autenticação:', err);
      addLog('Falha ao conectar ao serviço de autenticação do Supabase.', 'error');
    }
  }

  // Fetch real-time user profile (credits & plan)
  async function loadUserProfile() {
    if (!userSession) return;
    try {
      const res = await fetch('/api/profile', {
        headers: { 'Authorization': `Bearer ${userSession.access_token}` }
      });
      if (!res.ok) throw new Error('Falha ao obter perfil.');
      const profile = await res.json();

      userEmailSpan.textContent = profile.email;
      userCreditsSpan.textContent = profile.credits;
      userPlanSpan.textContent = profile.plan;
      userProfileHeader.style.display = 'flex';
    } catch (err) {
      console.error('Erro ao carregar perfil:', err);
    }
  }

  // Logout Trigger
  if (btnLogout) {
    btnLogout.addEventListener('click', async () => {
      if (confirm('Deseja realmente sair da sua conta?')) {
        if (supabaseClient) {
          await supabaseClient.auth.signOut();
        } else {
          window.location.href = '/login.html';
        }
      }
    });
  }

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

  // Leaflet map variables
  let leafletMap = null;
  let leafletMarker = null;

  // Global show map modal trigger
  window.showLeadMap = function(name, address, lat, lng) {
    const modal = document.getElementById('map-modal');
    const modalTitle = document.getElementById('map-modal-title');
    const modalAddress = document.getElementById('map-modal-address');
    
    modalTitle.textContent = name;
    modalAddress.textContent = address || 'Sem endereço cadastrado.';
    modal.classList.add('visible');
    
    // Give modal time to animate display before Leaflet sizes container
    setTimeout(() => {
      if (!leafletMap) {
        leafletMap = L.map('leaflet-map').setView([lat, lng], 15);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '© OpenStreetMap contributors'
        }).addTo(leafletMap);
      } else {
        leafletMap.setView([lat, lng], 15);
      }
      
      if (leafletMarker) {
        leafletMarker.setLatLng([lat, lng]);
      } else {
        leafletMarker = L.marker([lat, lng]).addTo(leafletMap);
      }
      
      leafletMarker.bindPopup(`<b>${name}</b>`).openPopup();
      
      // Force map recalculation
      leafletMap.invalidateSize();
    }, 200);
  };

  // Close map modal
  document.getElementById('btn-close-map').addEventListener('click', () => {
    document.getElementById('map-modal').classList.remove('visible');
  });

  // Close map modal on clicking overlay
  document.getElementById('map-modal').addEventListener('click', (e) => {
    if (e.target.id === 'map-modal') {
      document.getElementById('map-modal').classList.remove('visible');
    }
  });

  // Filtering and Sorting Application State
  let activeFilterChip = 'all';
  let activeSortOption = 'none';

  // Add lead row to UI Table directly (no filter checks)
  function appendLeadToTableDirect(lead, index) {
    const row = document.createElement('tr');
    row.dataset.index = index;
    
    // Smooth stagger delay waterfall effect (instant during live scrape)
    const delay = scrapeActive ? 0 : Math.min(15, index) * 0.025;
    row.style.animation = `rowFadeIn 0.35s cubic-bezier(0.4, 0, 0.2, 1) ${delay}s both`;

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

    // Map button only if lat/lng are present
    let mapBtn = '';
    if (lead.lat && lead.lng) {
      mapBtn = `
        <button class="btn-action btn-map-view" onclick="window.showLeadMap('${lead.name.replace(/'/g, "\\'")}', '${lead.address.replace(/'/g, "\\'")}', ${lead.lat}, ${lead.lng})" title="Ver no Mapa Interativo">
          <i class="fa-solid fa-location-dot"></i>
        </button>
      `;
    }

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
          ${mapBtn}
          <a href="${lead.url}" target="_blank" class="btn-action btn-maps-link" title="Ver no Google Maps">
            <i class="fa-solid fa-map-location-dot"></i>
          </a>
        </div>
      </td>
    `;

    leadsTableBody.appendChild(row);
  }

  // Reactive UI Redraw based on state, filters, sorting
  function renderFilteredTable() {
    const filterText = tableFilter.value.toLowerCase().trim();
    
    // 1. Filter leads
    let filtered = [...allLeads];
    
    if (activeFilterChip === 'has-site') {
      filtered = filtered.filter(l => l.website);
    } else if (activeFilterChip === 'has-phone') {
      filtered = filtered.filter(l => l.phone);
    } else if (activeFilterChip === 'has-email') {
      filtered = filtered.filter(l => l.email);
    }
    
    if (filterText) {
      filtered = filtered.filter(l => 
        (l.name && l.name.toLowerCase().includes(filterText)) ||
        (l.phone && l.phone.toLowerCase().includes(filterText)) ||
        (l.category && l.category.toLowerCase().includes(filterText)) ||
        (l.address && l.address.toLowerCase().includes(filterText)) ||
        (l.email && l.email.toLowerCase().includes(filterText))
      );
    }
    
    // 2. Sort leads
    if (activeSortOption === 'rating-desc') {
      filtered.sort((a, b) => {
        const ra = parseFloat(a.rating) || 0;
        const rb = parseFloat(b.rating) || 0;
        return rb - ra;
      });
    } else if (activeSortOption === 'reviews-desc') {
      filtered.sort((a, b) => {
        const ca = parseInt(a.reviewsCount) || 0;
        const cb = parseInt(b.reviewsCount) || 0;
        return cb - ca;
      });
    }
    
    // 3. Render
    leadsTableBody.innerHTML = '';
    
    if (filtered.length === 0) {
      leadsTableBody.innerHTML = `
        <tr class="empty-row">
          <td colspan="10">
            <div class="empty-state">
              <i class="fa-solid fa-folder-open empty-icon"></i>
              <p>Nenhum lead encontrado com os filtros aplicados.</p>
            </div>
          </td>
        </tr>
      `;
      return;
    }
    
    filtered.forEach((lead, i) => {
      appendLeadToTableDirect(lead, i + 1);
    });
  }

  // Reactive push handler called by SSE Event Listener
  function appendLeadToTable(lead, index) {
    // Simply trigger redrawing leads table (which filters/sorts in real-time)
    renderFilteredTable();
  }

  // Quick Chips Event Listeners
  const filterChips = document.querySelectorAll('.filter-chip');
  filterChips.forEach(chip => {
    chip.addEventListener('click', () => {
      filterChips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      activeFilterChip = chip.getAttribute('data-filter');
      renderFilteredTable();
    });
  });

  // Sorting Dropdown Listener
  const tableSort = document.getElementById('table-sort');
  tableSort.addEventListener('change', (e) => {
    activeSortOption = e.target.value;
    renderFilteredTable();
  });

  // Text Filter Listener
  tableFilter.addEventListener('input', () => {
    renderFilteredTable();
  });

  // Load Search History from server
  function loadSearchHistory() {
    if (!userSession) return;
    fetch('/api/history', {
      headers: { 'Authorization': `Bearer ${userSession.access_token}` }
    })
      .then(res => res.json())
      .then(history => {
        const historyList = document.getElementById('history-list');
        if (!historyList) return;
        
        if (history.length === 0) {
          historyList.innerHTML = '<div class="history-empty">Nenhuma busca no histórico.</div>';
          return;
        }
        
        historyList.innerHTML = '';
        history.forEach(item => {
          const div = document.createElement('div');
          div.className = 'history-item';
          div.title = `Clique para carregar esta busca: ${item.leadsCount} leads`;
          
          const formattedDate = new Date(item.date).toLocaleDateString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
          });
          
          div.innerHTML = `
            <div class="history-item-icon">
              <i class="fa-solid fa-file-csv"></i>
            </div>
            <div class="history-item-details">
              <span class="history-item-title">${item.title}</span>
              <span class="history-item-subtitle">${item.subtitle} • <span class="badge-count">${item.leadsCount} leads</span></span>
            </div>
            <div class="history-item-actions">
              <span class="history-item-date">${formattedDate}</span>
              <button class="delete-history-btn" title="Excluir busca" data-id="${item.searchId}">
                <i class="fa-solid fa-trash-can"></i>
              </button>
            </div>
          `;
          
          div.addEventListener('click', () => {
            loadHistoricalSearch(item.searchId);
          });

          const deleteBtn = div.querySelector('.delete-history-btn');
          if (deleteBtn) {
            deleteBtn.addEventListener('click', (e) => {
              e.stopPropagation(); // Avoid loading the clicked history card
              if (confirm(`Deseja realmente excluir permanentemente a busca "${item.title}"?`)) {
                deleteHistoryItem(item.searchId);
              }
            });
          }
          
          historyList.appendChild(div);
        });
      })
      .catch(err => console.error('Erro ao carregar histórico:', err));
  }

  // Delete search history item from server and reset UI if active
  function deleteHistoryItem(searchId) {
    if (!userSession) return;
    fetch(`/api/history?searchId=${searchId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${userSession.access_token}` }
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          addLog('Busca histórica excluída com sucesso.', 'success');
          
          // Clear active display if it corresponds to the deleted history
          if (activeJsonFilename.includes(searchId)) {
            allLeads = [];
            activeJsonFilename = '';
            activeCsvFilename = '';
            updateStats();
            renderFilteredTable();
            document.getElementById('export-card').classList.remove('visible');
          }
          
          loadSearchHistory();
        } else {
          addLog(`Erro ao excluir histórico: ${data.error || 'Erro desconhecido'}`, 'error');
        }
      })
      .catch(err => {
        console.error('Erro ao excluir histórico:', err);
        addLog('Falha na comunicação com o servidor ao excluir histórico.', 'error');
      });
  }

  // Load selected search history details into dashboard
  function loadHistoricalSearch(searchId) {
    addLog(`Carregando busca histórica: ${searchId}...`, 'system');
    
    // Reset filters
    activeFilterChip = 'all';
    filterChips.forEach(c => c.classList.remove('active'));
    document.querySelector('.filter-chip[data-filter="all"]').classList.add('active');
    
    activeSortOption = 'none';
    tableSort.value = 'none';
    tableFilter.value = '';
    
    if (!userSession) return;
    fetch(`/api/history/load?searchId=${searchId}`, {
      headers: { 'Authorization': `Bearer ${userSession.access_token}` }
    })
      .then(res => res.json())
      .then(data => {
        allLeads = data.leads;
        activeJsonFilename = data.jsonFilename;
        activeCsvFilename = data.csvFilename;
        
        // Update Stats and redraw
        updateStats();
        renderFilteredTable();
        
        // Enable controls
        exportCard.classList.add('visible');
        tableFilter.disabled = false;
        tableSort.disabled = false;
        
        // Setup download links
        downloadCsv.href = `/api/download/csv?file=${activeCsvFilename}`;
        downloadJson.href = `/api/download/json?file=${activeJsonFilename}`;
        
        addLog(`Carregados ${allLeads.length} leads do histórico com sucesso!`, 'success');
      })
      .catch(err => {
        console.error('Erro ao carregar histórico:', err);
        addLog(`Erro ao carregar histórico do banco de dados.`, 'error');
      });
  }

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
    tableSort.value = 'none';
    tableSort.disabled = true;
    activeFilterChip = 'all';
    filterChips.forEach(c => c.classList.remove('active'));
    document.querySelector('.filter-chip[data-filter="all"]').classList.add('active');
    
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
      tableSort.disabled = false;
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

    // Connect to SaaS Queue API instead of direct síncrono SSE
    addLog('Enviando busca para a fila de processamento assíncrona na VPS...', 'system');
    progressStatusText.textContent = 'Enfileirando tarefa...';

    if (!userSession) return;

    fetch('/api/scrape-queue', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userSession.access_token}`
      },
      body: JSON.stringify({
        query: query,
        limit: limit,
        city: city
      })
    })
    .then(res => {
      if (!res.ok) {
        return res.json().then(err => { throw new Error(err.error || 'Erro na requisição'); });
      }
      return res.json();
    })
    .then(data => {
      const searchId = data.searchId;
      addLog(`Busca enfileirada no Redis com sucesso! ID da Busca: ${searchId}`, 'success');
      addLog('O Worker na VPS iniciou o processamento do Google Maps. Acompanhando progresso...', 'system');
      progressStatusText.textContent = 'Worker extraindo...';

      let lastLeadsLength = 0;
      let pollingInterval = setInterval(() => {
        if (!scrapeActive) {
          clearInterval(pollingInterval);
          return;
        }

        fetch(`/api/scrape-status/${searchId}`, {
          headers: { 'Authorization': `Bearer ${userSession.access_token}` }
        })
        .then(res => res.json())
        .then(statusData => {
          const leads = statusData.leads || [];
          
          // Adiciona logs e preenche a tabela conforme os leads chegam na nuvem
          if (leads.length > lastLeadsLength) {
            for (let i = lastLeadsLength; i < leads.length; i++) {
              const lead = leads[i];
              allLeads.push(lead);
              appendLeadToTable(lead, allLeads.length);
              updateStats();
              
              // Cálculo da barra de progresso
              const currentProgressPercent = Math.min(100, Math.round((allLeads.length / limit) * 100));
              progressBarFill.style.width = `${currentProgressPercent}%`;
              progressPercentVal.textContent = `${currentProgressPercent}%`;
              
              addLog(`Lead minerado pelo Worker: [${allLeads.length}/${limit}] ${lead.name}`, 'success');
            }
            lastLeadsLength = leads.length;
          }

          // Verifica o status global da busca
          if (statusData.status === 'completed') {
            clearInterval(pollingInterval);
            addLog(`Extração concluída com sucesso pelo Worker! Total: ${leads.length} leads.`, 'success');
            progressStatusText.textContent = 'Extração finalizada.';
            progressBarFill.style.width = '100%';
            progressPercentVal.textContent = '100%';
            
            systemStatus.className = 'status-badge done';
            systemStatusText.textContent = 'Concluído';
            
            // Configurar links de download para o CSV e JSON criados pela busca na nuvem
            const finalJson = statusData.jsonFilename || `leads_${Date.now()}.json`;
            const finalCsv = statusData.csvFilename || `leads_${Date.now()}.csv`;
            downloadCsv.href = `/api/download/csv?file=${finalCsv}`;
            downloadJson.href = `/api/download/json?file=${finalJson}`;
            exportCard.classList.add('visible');
            tableFilter.disabled = false;
            tableSort.disabled = false;
            loadSearchHistory();
            loadUserProfile(); // Visual refresh of credits!
            
            // Limpeza de estado e reativação dos campos
            scrapeActive = false;
            btnStart.disabled = false;
            btnStop.disabled = true;
            queryInput.disabled = false;
            cityInput.disabled = false;
            limitInput.disabled = false;
            headlessMode.disabled = false;
          } else if (statusData.status === 'failed') {
            clearInterval(pollingInterval);
            addLog(`Erro de raspagem: Ocorreu uma falha no processador de fila na VPS.`, 'error');
            progressStatusText.textContent = 'Erro durante a busca.';
            
            systemStatus.className = 'status-badge';
            systemStatusText.textContent = 'Erro na extração';
            loadUserProfile(); // Visual refresh of credits even if failed!
            
            scrapeActive = false;
            btnStart.disabled = false;
            btnStop.disabled = true;
            queryInput.disabled = false;
            cityInput.disabled = false;
            limitInput.disabled = false;
            headlessMode.disabled = false;
          }
        })
        .catch(err => {
          console.error('Erro de polling:', err);
        });
      }, 2000);

      // Salva referência do intervalo para o botão Stop poder cancelar
      eventSource = {
        close: () => {
          clearInterval(pollingInterval);
        }
      };
    })
    .catch(err => {
      addLog(`Erro ao enfileirar busca: ${err.message}`, 'error');
      progressStatusText.textContent = 'Erro ao enfileirar.';
      systemStatus.className = 'status-badge';
      systemStatusText.textContent = 'Erro na extração';
      
      scrapeActive = false;
      btnStart.disabled = false;
      btnStop.disabled = true;
      queryInput.disabled = false;
      cityInput.disabled = false;
      limitInput.disabled = false;
      headlessMode.disabled = false;
    });
    loadSearchHistory();
  });

  // Fullscreen Table Mode Toggle
  const btnToggleFullscreen = document.getElementById('btn-toggle-fullscreen');
  const tablePanel = document.querySelector('.table-panel');
  
  if (btnToggleFullscreen && tablePanel) {
    btnToggleFullscreen.addEventListener('click', () => {
      const isFullscreen = tablePanel.classList.toggle('fullscreen');
      const icon = btnToggleFullscreen.querySelector('i');
      
      if (isFullscreen) {
        icon.className = 'fa-solid fa-compress';
        btnToggleFullscreen.title = 'Minimizar Tabela';
        addLog('Modo Tela Cheia ativado.', 'system');
      } else {
        icon.className = 'fa-solid fa-expand';
        btnToggleFullscreen.title = 'Ver em Tela Cheia';
        addLog('Modo Tela Cheia desativado.', 'system');
      }
    });
  }

  // Trigger Supabase Auth flow on load
  initAuth();
});
