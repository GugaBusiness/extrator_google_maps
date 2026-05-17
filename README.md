# 🎯 MapsMiner: Extrator de Leads do Google Maps Premium

O **MapsMiner** é uma solução de alta performance para extração automatizada de dados (leads) do Google Maps. O projeto conta com uma interface web de altíssimo nível (Dark Theme com Glassmorphism) que exibe o andamento da raspagem em tempo real e permite exportações instantâneas.

---

## ✨ Recursos Exclusivos

1. **Interface de Elite**:
   - Estética futurista e extremamente polida com Glassmorphism e orbes luminosas animadas.
   - Painel de estatísticas ao vivo (Leads Extraídos, Com Telefone, Com Website, Avaliação Média).
   - Console terminal interativo que imprime cada passo da automação.

2. **Performance e Estabilidade**:
   - Baseado em **Node.js** + **Playwright** (motor oficial de automação moderno).
   - Uso de seletores funcionais e de dados (`data-item-id`) de alta resiliência para maior imunidade contra mudanças estruturais no Google Maps.
   - Navegação direta e isolamento de páginas de detalhes para estabilidade absoluta (prevenindo falhas de clique e deslocamentos de feed).

3. **Interatividade em Tempo Real**:
   - Streaming de dados utilizando **Server-Sent Events (SSE)** (zero polling).
   - Tabela dinâmica e filtrável instantaneamente no frontend.
   - Opção para alternar entre o modo silencioso (Headless) e visual (Headful), permitindo que você veja o navegador abrindo e rolando a tela.

4. **Exportação Facilitada**:
   - Download imediato em formatos estruturados **CSV** (otimizado com UTF-8 BOM para abertura perfeita no Microsoft Excel) e **JSON**.

---

## 📂 Estrutura do Projeto

* 📄 [package.json](file:///c:/Users/Guga/Downloads/extrator_google_maps/package.json) — Gerenciador de dependências do Node.js.
* 🖥️ [server.js](file:///c:/Users/Guga/Downloads/extrator_google_maps/server.js) — Servidor Express e motor de scraping automatizado com Playwright.
* 🌐 [public/index.html](file:///c:/Users/Guga/Downloads/extrator_google_maps/public/index.html) — Layout semântico do painel de controle e painel de leads.
* 🎨 [public/style.css](file:///c:/Users/Guga/Downloads/extrator_google_maps/public/style.css) — Estilização Vanilla CSS premium (Dark mode, neon glows, animações e responsividade).
* ⚙️ [public/app.js](file:///c:/Users/Guga/Downloads/extrator_google_maps/public/app.js) — Controlador frontend, manipulação DOM dinâmica e motor de conexão SSE.

---

## 🚀 Como Executar

### 1. Iniciar o Servidor
Execute o seguinte comando no terminal do projeto para iniciar o servidor:
```bash
npm run dev
```

### 2. Acessar a Aplicação
Abra seu navegador favorito e acesse:
👉 **[http://localhost:3000](http://localhost:3000)**

### 3. Fazer sua Busca
1. Digite a consulta desejada (ex: `Restaurantes em Pinheiros`).
2. Defina o limite máximo de resultados (ex: `15`).
3. Clique em **Iniciar Mineração**.
4. Acompanhe a mágica acontecer! Ao finalizar, basta clicar nos botões verdes de exportação no topo das estatísticas.
