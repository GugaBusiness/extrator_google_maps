# Use a imagem oficial da Microsoft Playwright que ja possui todos os navegadores e dependencias pre-instaladas
FROM mcr.microsoft.com/playwright:v1.44.0-jammy

# Diretorio de trabalho da aplicacao
WORKDIR /app

# Copia os arquivos de dependencias do Node
COPY package*.json ./

# Evita o download duplicado de navegadores para tornar a compilacao na VPS 10 vezes mais rapida!
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Instala apenas os modulos do node
RUN npm ci

# Copia todo o restante dos arquivos do projeto
COPY . .

# Expõe a porta do servidor web
EXPOSE 3000

# Comando padrao para iniciar o servidor web
# (No Easypanel do mapsminer-worker, ele sera substituido automaticamente pelo comando "node worker.js")
CMD ["npm", "start"]
