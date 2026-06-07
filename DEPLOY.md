# VPS Drive — Deploy na sua VPS

Guia completo para hospedar o VPS Drive na sua própria VPS com Node.js.

---

## Requisitos

- Node.js 20+ (recomendado: 22 LTS)
- pnpm 10+
- VPS Linux (Ubuntu 22.04+ recomendado)
- Domínio ou IP público

---

## 1. Instalar dependências na VPS

```bash
# Node.js (via nvm)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 22
nvm use 22

# pnpm
npm install -g pnpm

# PM2 (gerenciador de processo)
npm install -g pm2
```

---

## 2. Copiar o projeto para a VPS

```bash
# Na sua máquina local — copie o projeto para a VPS:
rsync -av --exclude='node_modules' --exclude='.git' \
  /caminho/do/projeto/ usuario@sua-vps:/opt/vps-drive/

# OU via git (se usar um repositório):
ssh usuario@sua-vps
git clone https://seu-repositorio.git /opt/vps-drive
```

---

## 3. Instalar dependências

```bash
cd /opt/vps-drive
pnpm install
```

---

## 4. Configurar variáveis de ambiente

Crie o arquivo `/opt/vps-drive/.env` (ou configure no sistema):

```bash
# Diretório onde os arquivos serão armazenados na VPS
# MUDE para o caminho desejado, ex: /data/vps-share
STORAGE_PATH=/data/vps-share

# Porta do servidor API
PORT=5000

# ⚠️  As chaves do Clerk são configuradas automaticamente pelo Replit
# quando você publica o app. NÃO copie as chaves de desenvolvimento.
# Use as chaves de PRODUÇÃO do seu app Clerk:
CLERK_SECRET_KEY=sk_live_...
CLERK_PUBLISHABLE_KEY=pk_live_...
VITE_CLERK_PUBLISHABLE_KEY=pk_live_...

# Ambiente de produção
NODE_ENV=production
```

Crie o diretório de armazenamento:

```bash
mkdir -p /data/vps-share
chmod 755 /data/vps-share
```

---

## 5. Build do frontend

```bash
cd /opt/vps-drive
pnpm --filter @workspace/vps-drive run build
```

Os arquivos compilados ficam em `artifacts/vps-drive/dist/public/`.

---

## 6. Build da API

```bash
cd /opt/vps-drive
pnpm --filter @workspace/api-server run build
```

---

## 7. Configurar o servidor (Nginx)

O Nginx faz proxy das requisições para o Node.js e serve o frontend estático.

```bash
sudo apt install nginx -y
```

Crie `/etc/nginx/sites-available/vps-drive`:

```nginx
server {
    listen 80;
    server_name seu-dominio.com;  # ou seu IP

    # Frontend estático
    location / {
        root /opt/vps-drive/artifacts/vps-drive/dist/public;
        try_files $uri $uri/ /index.html;
    }

    # API Node.js
    location /api/ {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # Aumentar timeout e tamanho para uploads de arquivos grandes
        proxy_read_timeout 300;
        proxy_connect_timeout 300;
        proxy_send_timeout 300;
        client_max_body_size 500M;
    }

    # Clerk proxy (autenticação)
    location /api/__clerk/ {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Ative o site:

```bash
sudo ln -s /etc/nginx/sites-available/vps-drive /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

## 8. Rodar com PM2

```bash
cd /opt/vps-drive

# Iniciar o servidor API com PM2
PORT=5000 STORAGE_PATH=/data/vps-share NODE_ENV=production \
  pm2 start artifacts/api-server/dist/index.mjs --name "vps-drive-api"

# Salvar configuração para reiniciar automaticamente
pm2 save
pm2 startup  # siga as instruções que o PM2 mostrar
```

---

## 9. HTTPS com Let's Encrypt (recomendado)

```bash
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d seu-dominio.com
```

O Certbot configura HTTPS automaticamente.

---

## 10. Verificar funcionamento

```bash
# Checar se o servidor está rodando
pm2 status

# Ver logs
pm2 logs vps-drive-api

# Testar a API
curl http://localhost:5000/api/healthz
```

Acesse `http://seu-dominio.com` no navegador — faça login e comece a usar!

---

## Gerenciar usuários

Os usuários são gerenciados pelo painel do **Clerk**. Após fazer deploy:

1. Acesse [dashboard.clerk.com](https://dashboard.clerk.com)
2. Selecione seu app
3. Vá em **Users** para criar, bloquear ou remover usuários

---

## Atualizar o sistema

```bash
cd /opt/vps-drive
git pull  # ou rsync do novo código

pnpm install
pnpm --filter @workspace/vps-drive run build
pnpm --filter @workspace/api-server run build

pm2 restart vps-drive-api
sudo systemctl reload nginx
```

---

## Variáveis de ambiente — referência completa

| Variável | Obrigatório | Descrição |
|---|---|---|
| `STORAGE_PATH` | Sim | Diretório onde os arquivos são armazenados |
| `PORT` | Sim | Porta do servidor API (ex: 5000) |
| `CLERK_SECRET_KEY` | Sim | Chave secreta do Clerk (produção) |
| `CLERK_PUBLISHABLE_KEY` | Sim | Chave pública do Clerk (produção) |
| `VITE_CLERK_PUBLISHABLE_KEY` | Sim | Mesma chave pública (para o frontend) |
| `NODE_ENV` | Sim | `production` |
