# VPS Drive — Deploy na sua VPS

Guia completo para hospedar o VPS Drive na sua própria VPS com Node.js.

---

## Requisitos

- Node.js 20+ (recomendado: 22 LTS)
- pnpm 10+
- PostgreSQL 14+ (banco de dados)
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

# Ou pelo repositório oficial do GitHub:
ssh usuario@sua-vps
git clone --depth 1 https://github.com/rodolfolucaslima18-cmd/VPS-Driver.git /opt/vps-drive
```

---

### Instalação com um comando

Para iniciar o instalador diretamente a partir do repositório oficial:

```bash
sudo bash <(curl -fsSL https://raw.githubusercontent.com/rodolfolucaslima18-cmd/VPS-Driver/main/scripts/install.sh)
```

---

## 3. Instalar dependências

```bash
cd /opt/vps-drive
pnpm install
```

---

## 4. Configurar variáveis de ambiente

Crie o arquivo `/opt/vps-drive/.env`:

```bash
# Diretório onde os arquivos serão armazenados na VPS
STORAGE_PATH=/data/vps-drive

# Porta do servidor API
PORT=5000

# URL de conexão com o PostgreSQL (obrigatório)
DATABASE_URL=postgresql://usuario:senha@localhost:5432/vpsdrive

# Chave secreta para assinar sessões — gere com: openssl rand -hex 32
SESSION_SECRET=gere-uma-chave-secreta-aleatoria-aqui

# Defina como "true" somente se o app estiver atrás de HTTPS (Nginx + TLS).
# Deixe "false" para instalações via IP ou sem certificado TLS.
COOKIE_SECURE=true

# Ambiente
NODE_ENV=production
```

Crie o diretório de armazenamento:

```bash
mkdir -p /data/vps-drive
chmod 755 /data/vps-drive
```

---

## 5. Aplicar schema do banco de dados

Execute este passo **uma vez** antes de iniciar o servidor pela primeira vez (e sempre que o schema for atualizado):

```bash
cd /opt/vps-drive
DATABASE_URL=postgresql://usuario:senha@localhost:5432/vpsdrive \
  pnpm --filter @workspace/db run push --accept-data-loss
```

---

## 6. Build do frontend

```bash
cd /opt/vps-drive
pnpm --filter @workspace/vps-drive run build
```

Os arquivos compilados ficam em `artifacts/vps-drive/dist/public/`.

---

## 7. Build da API

```bash
cd /opt/vps-drive
pnpm --filter @workspace/api-server run build
```

---

## 8. Configurar o servidor (Nginx)

O Nginx faz proxy das requisições para o Node.js e serve o frontend estático.

```bash
sudo apt install nginx -y
```

Crie `/etc/nginx/sites-available/vps-drive`:

```nginx
server {
    listen 80;
    server_name seu-dominio.com;  # ou seu IP

    client_max_body_size 500M;

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

        proxy_read_timeout 300;
        proxy_connect_timeout 300;
        proxy_send_timeout 300;
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

## 9. Rodar com PM2

```bash
cd /opt/vps-drive

# Iniciar o servidor API com PM2
pm2 start artifacts/api-server/dist/index.mjs \
  --name "vps-drive-api" \
  --cwd /opt/vps-drive

# Salvar configuração para reiniciar automaticamente
pm2 save
pm2 startup  # siga as instruções que o PM2 mostrar
```

As variáveis de ambiente são carregadas automaticamente do arquivo `.env`.

---

## 10. HTTPS com Let's Encrypt (recomendado)

```bash
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d seu-dominio.com
```

O Certbot configura HTTPS automaticamente. Após isso, certifique-se de que o `.env` contém `COOKIE_SECURE=true` e reinicie:

```bash
pm2 restart vps-drive-api
```

---

## 11. Verificar funcionamento

```bash
# Checar se o servidor está rodando
pm2 status

# Ver logs
pm2 logs vps-drive-api

# Testar a API
curl http://localhost:5000/api/healthz
```

Acesse `http://seu-dominio.com/setup` no navegador para criar o primeiro usuário administrador.

---

## Gerenciar usuários

Os usuários são gerenciados pelo **painel de administração** integrado ao VPS Drive:

1. Faça login com o usuário Master
2. Clique em **Admin** no menu do Drive
3. Crie, suspenda ou remova usuários diretamente pelo painel

Não há necessidade de serviços externos — tudo é auto-hospedado.

---

## Atualizar o sistema

### Pelo painel

Faça login como usuário Master e abra **Admin**. Em **Configuração de Atualização**,
confirme o repositório:

```text
https://github.com/rodolfolucaslima18-cmd/VPS-Driver.git
```

Deixe a branch como `main` e clique em **Atualizar agora**. O processo mantém o
arquivo `.env`, o banco de dados e os arquivos enviados pelos usuários. Por
segurança, ele não aplica mudanças automáticas ao schema do banco; use apenas
migrações revisadas antes de atualizar uma versão que exija alteração de schema.

### Pelo terminal

Para qualquer instalação, inclusive uma que ainda tenha o script antigo, execute:

```bash
curl -fsSL https://raw.githubusercontent.com/rodolfolucaslima18-cmd/VPS-Driver/main/scripts/update.sh | sudo bash
```

Depois da primeira atualização, você também pode executar a cópia local:

```bash
sudo bash /opt/vps-drive/scripts/update.sh
```

---

## Variáveis de ambiente — referência completa

| Variável | Obrigatório | Descrição |
|---|---|---|
| `STORAGE_PATH` | Sim | Diretório onde os arquivos são armazenados |
| `PORT` | Sim | Porta do servidor API (ex: 5000) |
| `DATABASE_URL` | Sim | URL de conexão PostgreSQL |
| `SESSION_SECRET` | Sim | Chave secreta para sessões (gere com `openssl rand -hex 32`) |
| `COOKIE_SECURE` | Não | `true` se HTTPS estiver ativo, `false` para HTTP |
| `NODE_ENV` | Sim | `production` |
