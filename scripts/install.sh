#!/usr/bin/env bash
# ============================================================
#  VPS Drive — Instalador Interativo
#  Compatível com Ubuntu 20.04+ / Debian 11+
#
#  Uso:
#    sudo bash scripts/install.sh             (de dentro do projeto)
#    sudo bash <(curl -sL https://HOST/api/download/install.sh)
# ============================================================
set -euo pipefail

# ── Cores ───────────────────────────────────────────────────
BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

step()  { echo -e "\n${CYAN}${BOLD}▶ $1${NC}"; }
ok()    { echo -e "${GREEN}✓ $1${NC}"; }
warn()  { echo -e "${YELLOW}⚠ $1${NC}"; }
error() { echo -e "${RED}✗ $1${NC}" >&2; exit 1; }

# ── Banner ───────────────────────────────────────────────────
echo -e "
${BOLD}${CYAN}╔══════════════════════════════════════╗
║         VPS Drive — Instalador       ║
╚══════════════════════════════════════╝${NC}
"
echo -e "Este script instala e configura o VPS Drive na sua VPS."
echo -e "Requisitos: Ubuntu 20.04+ ou Debian 11+\n"

# ── Verificar root ───────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
  error "Execute este instalador como root: sudo bash scripts/install.sh"
fi

# ── Verificar sistema operacional ────────────────────────────
step "Verificando sistema operacional..."
if [[ -f /etc/os-release ]]; then
  . /etc/os-release
  if [[ "$ID" != "ubuntu" && "$ID" != "debian" && "${ID_LIKE:-}" != *"debian"* ]]; then
    error "Sistema não suportado: $PRETTY_NAME. Use Ubuntu 20.04+ ou Debian 11+."
  fi
  ok "Sistema compatível: $PRETTY_NAME"
else
  error "Não foi possível identificar o sistema operacional."
fi

# ── Perguntas de configuração ────────────────────────────────
echo -e "\n${BOLD}Configuração da instalação${NC}"
echo "Responda as perguntas abaixo (Enter = valor padrão entre colchetes):"
echo ""

read -rp "IP ou domínio da VPS (ex: 192.168.1.1 ou meusite.com): " VPS_HOST
[[ -z "$VPS_HOST" ]] && error "O IP ou domínio é obrigatório."

echo ""
echo "O VPS Drive requer um banco de dados PostgreSQL."
echo "Exemplo de URL: postgresql://usuario:senha@localhost:5432/vpsdrive"
read -rp "URL de conexão do PostgreSQL (DATABASE_URL): " DATABASE_URL
[[ -z "$DATABASE_URL" ]] && error "DATABASE_URL é obrigatório para o VPS Drive funcionar."

# Detectar se é IP ou domínio
is_ip() {
  [[ "$1" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]
}

USE_HTTPS=false
CERTBOT_EMAIL=""
if is_ip "$VPS_HOST"; then
  warn "Host é um endereço IP — HTTPS via Let's Encrypt requer um domínio. Continuando com HTTP."
else
  echo ""
  read -rp "Deseja configurar HTTPS com Let's Encrypt? (requer domínio apontado para esta VPS) [s/N]: " WANT_HTTPS
  if [[ "${WANT_HTTPS,,}" == "s" ]]; then
    read -rp "E-mail para notificações do Let's Encrypt: " CERTBOT_EMAIL
    [[ -z "$CERTBOT_EMAIL" ]] && error "E-mail é obrigatório para o Certbot."
    USE_HTTPS=true
  fi
fi

echo ""
read -rp "Deseja instalar o OnlyOffice Document Server para edição de documentos? (requer Docker, ~1 GB) [s/N]: " WANT_ONLYOFFICE
VITE_ONLYOFFICE_URL=""
if [[ "${WANT_ONLYOFFICE,,}" == "s" ]]; then
  VITE_ONLYOFFICE_URL="http://$VPS_HOST:8080"
fi

read -rp "Pasta para guardar os arquivos [/data/vps-drive]: " STORAGE_PATH
STORAGE_PATH="${STORAGE_PATH:-/data/vps-drive}"

read -rp "Porta do servidor interno [5000]: " APP_PORT
APP_PORT="${APP_PORT:-5000}"

read -rp "Pasta de instalação do app [/opt/vps-drive]: " INSTALL_DIR
INSTALL_DIR="${INSTALL_DIR:-/opt/vps-drive}"

echo ""
echo "Defina as credenciais do usuário administrador (criadas automaticamente ao final):"
read -rp "Nome do administrador: " ADMIN_NAME
[[ -z "$ADMIN_NAME" ]] && error "O nome do administrador é obrigatório."
read -rp "E-mail do administrador: " ADMIN_EMAIL
[[ -z "$ADMIN_EMAIL" ]] && error "O e-mail do administrador é obrigatório."
read -srp "Senha do administrador (mín. 8 caracteres): " ADMIN_PASSWORD
echo ""
[[ ${#ADMIN_PASSWORD} -lt 8 ]] && error "A senha deve ter pelo menos 8 caracteres."

# ── Resumo ───────────────────────────────────────────────────
echo -e "\n${BOLD}Resumo:${NC}"
echo "  Host:              $VPS_HOST"
echo "  Banco de dados:    ${DATABASE_URL%%@*}@..."
echo "  Armazenamento:     $STORAGE_PATH"
echo "  Porta interna:     $APP_PORT"
echo "  Diretório do app:  $INSTALL_DIR"
echo "  Admin:             $ADMIN_NAME <$ADMIN_EMAIL>"
if [[ "$USE_HTTPS" == "true" ]]; then
  echo "  HTTPS:             Sim (Certbot / Let's Encrypt)"
  echo "  E-mail Certbot:    $CERTBOT_EMAIL"
else
  echo "  HTTPS:             Não (HTTP apenas)"
fi
if [[ -n "$VITE_ONLYOFFICE_URL" ]]; then
  echo "  OnlyOffice:        Sim ($VITE_ONLYOFFICE_URL)"
else
  echo "  OnlyOffice:        Não"
fi
echo ""
read -rp "Confirmar instalação? [s/N]: " CONFIRM
[[ "${CONFIRM,,}" != "s" ]] && { echo "Instalação cancelada."; exit 0; }

# ── Instalar pacotes base ─────────────────────────────────────
step "Atualizando lista de pacotes e instalando ferramentas básicas..."
apt-get update -qq
apt-get install -y -qq curl git rsync
ok "Ferramentas instaladas"

# ── Node.js 22 LTS ───────────────────────────────────────────
step "Verificando Node.js..."
if command -v node &>/dev/null && node --version 2>/dev/null | grep -qE "^v2[2-9]"; then
  ok "Node.js $(node --version) já está instalado"
else
  echo "  Instalando Node.js 22 LTS via NodeSource..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null 2>&1
  apt-get install -y -qq nodejs
  ok "Node.js $(node --version) instalado"
fi

# ── pnpm ────────────────────────────────────────────────────
step "Verificando pnpm..."
if command -v pnpm &>/dev/null; then
  PNPM_MAJOR=$(pnpm --version 2>/dev/null | cut -d. -f1)
  if [ "${PNPM_MAJOR:-0}" -ge 11 ]; then
    echo "  pnpm v$(pnpm --version) detectado."
    echo "  pnpm v11+ bloqueia build scripts por padrão (runDepsStatusCheck)."
    echo "  Instalando pnpm v10 para compatibilidade..."
    npm install -g pnpm@10 --quiet 2>&1 | tail -2
    hash -r
    ok "pnpm $(pnpm --version) instalado (v10 — compatível com este instalador)"
    echo "  → Para voltar ao pnpm v11 após a instalação: npm install -g pnpm@latest"
  else
    ok "pnpm $(pnpm --version) já está instalado"
  fi
else
  npm install -g pnpm@10 --quiet
  ok "pnpm $(pnpm --version) instalado"
fi

# ── PM2 ─────────────────────────────────────────────────────
step "Verificando PM2..."
if command -v pm2 &>/dev/null; then
  ok "PM2 já está instalado"
else
  npm install -g pm2 --quiet
  ok "PM2 instalado"
fi

# ── Nginx ────────────────────────────────────────────────────
step "Verificando Nginx..."
if command -v nginx &>/dev/null; then
  ok "Nginx já está instalado"
else
  apt-get install -y -qq nginx
  ok "Nginx instalado"
fi

# ── Localizar ou obter o código do app ────────────────────────
step "Localizando código do VPS Drive..."

# URLs injetadas pelo servidor no momento do download do script
DEFAULT_REPO_URL="__REPO_URL__"
INSTALLER_BASE_URL="__INSTALLER_BASE_URL__"
GIT_REPO="${VPS_DRIVE_REPO_URL:-$DEFAULT_REPO_URL}"

# Detectar modo local: executado de dentro do projeto
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-./install.sh}")" 2>/dev/null && pwd || echo "")"
PROJECT_ROOT=""

if [[ -n "$SCRIPT_DIR" && -f "$SCRIPT_DIR/../package.json" ]]; then
  PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
elif [[ -f "$PWD/package.json" ]]; then
  PROJECT_ROOT="$PWD"
fi

if [[ -n "$PROJECT_ROOT" ]]; then
  # Modo local: copiar arquivos do projeto para INSTALL_DIR
  echo "  Projeto encontrado em: $PROJECT_ROOT"
  if [[ "$PROJECT_ROOT" != "$INSTALL_DIR" ]]; then
    echo "  Copiando arquivos para $INSTALL_DIR..."
    mkdir -p "$INSTALL_DIR"
    rsync -a --exclude='node_modules' --exclude='.git' --exclude='*/dist' \
      "$PROJECT_ROOT/" "$INSTALL_DIR/"
  fi
  ok "Código localizado em $INSTALL_DIR"
elif [[ -f "$INSTALL_DIR/package.json" ]]; then
  # Instalação prévia detectada — atualizar via download se possível
  echo "  Instalação detectada em $INSTALL_DIR"
  if [[ -n "$INSTALLER_BASE_URL" && "$INSTALLER_BASE_URL" != "__INSTALLER_BASE_URL__" ]]; then
    echo "  Atualizando código via $INSTALLER_BASE_URL..."
    curl -sL "$INSTALLER_BASE_URL/api/download/project.tar.gz" \
      | tar -xzf - --overwrite --exclude='./node_modules' --exclude='./.git' -C "$INSTALL_DIR"
    echo "  Código atualizado"
  fi
  ok "Usando instalação existente em $INSTALL_DIR"
elif [[ -n "$GIT_REPO" && "$GIT_REPO" != "__REPO_URL__" ]]; then
  # Modo remoto via git
  echo "  Clonando repositório: $GIT_REPO"
  git clone "$GIT_REPO" "$INSTALL_DIR"
  ok "Repositório clonado em $INSTALL_DIR"
elif [[ -n "$INSTALLER_BASE_URL" && "$INSTALLER_BASE_URL" != "__INSTALLER_BASE_URL__" ]]; then
  # Baixar o código diretamente do servidor que serviu este instalador
  echo "  Baixando código de $INSTALLER_BASE_URL..."
  mkdir -p "$INSTALL_DIR"
  curl -sL "$INSTALLER_BASE_URL/api/download/project.tar.gz" \
    | tar -xzf - --exclude='./node_modules' --exclude='./.git' -C "$INSTALL_DIR"
  ok "Código extraído em $INSTALL_DIR"
else
  # Último recurso: pedir URL git manualmente
  echo ""
  echo -e "${YELLOW}Código do projeto não encontrado.${NC}"
  echo ""
  read -rp "URL do repositório git (ou Enter para cancelar): " MANUAL_REPO
  [[ -z "$MANUAL_REPO" ]] && error "URL do repositório necessária."
  git clone "$MANUAL_REPO" "$INSTALL_DIR"
  ok "Repositório clonado em $INSTALL_DIR"
fi

cd "$INSTALL_DIR"

# ── Arquivo .env ─────────────────────────────────────────────
step "Gerando arquivo .env..."
SESSION_SECRET=$(openssl rand -hex 32)
COOKIE_SECURE="false"
if [[ "$USE_HTTPS" == "true" ]]; then
  COOKIE_SECURE="true"
fi
cat > "$INSTALL_DIR/.env" <<EOF
STORAGE_PATH=$STORAGE_PATH
PORT=$APP_PORT
DATABASE_URL=$DATABASE_URL
SESSION_SECRET=$SESSION_SECRET
COOKIE_SECURE=$COOKIE_SECURE
BASE_PATH=/
NODE_ENV=production
VPS_HOST=$VPS_HOST
VITE_ONLYOFFICE_URL=$VITE_ONLYOFFICE_URL
EOF
chmod 600 "$INSTALL_DIR/.env"
ok "Arquivo .env criado"

# ── Diretório de armazenamento ───────────────────────────────
step "Criando diretório de armazenamento..."
mkdir -p "$STORAGE_PATH"
chmod 755 "$STORAGE_PATH"
ok "Diretório criado: $STORAGE_PATH"

# ── Instalar dependências ────────────────────────────────────
step "Instalando dependências (pnpm install)..."

# Limpar node_modules stale de tentativas anteriores.
# pnpm v11 lê node_modules/.modules.yaml para verificar estado de build approvals
# (runDepsStatusCheck). Estado antigo (de instalação com pnpm.json incompleto) bloqueia
# todos os `pnpm run`. O pnpm store global (~/.local/share/pnpm/store) preserva os
# pacotes baixados, então reinstalar é rápido (só recria hard-links).
if [ -d node_modules ]; then
  echo "  Limpando node_modules antigo para garantir estado limpo..."
  rm -rf node_modules
fi

# pnpm v11: pnpm.json sobrescreve pnpm-workspace.yaml para onlyBuiltDependencies.
# Deve listar TODOS os pacotes com build scripts para evitar ERR_PNPM_IGNORED_BUILDS
# tanto no pnpm install quanto no runDepsStatusCheck (chamado antes de pnpm run).
printf '{"onlyBuiltDependencies":["@swc/core","esbuild","msw","unrs-resolver"]}\n' > pnpm.json
# .npmrc: desabilita minimumReleaseAge (Replit-only) e garante onlyBuiltDependencies
grep -q "minimum-release-age" .npmrc 2>/dev/null \
  || echo "minimum-release-age=0" >> .npmrc
grep -q "onlyBuiltDependencies" .npmrc 2>/dev/null \
  || { echo "onlyBuiltDependencies[]=@swc/core" >> .npmrc
       echo "onlyBuiltDependencies[]=esbuild" >> .npmrc
       echo "onlyBuiltDependencies[]=msw" >> .npmrc
       echo "onlyBuiltDependencies[]=unrs-resolver" >> .npmrc; }

# Desativa set -e temporariamente para capturar saída e código de saída do pnpm
set +e
_pnpm_out=$(pnpm install --frozen-lockfile 2>&1); _pnpm_ec=$?
if [ $_pnpm_ec -ne 0 ]; then
  _pnpm_out=$(pnpm install 2>&1); _pnpm_ec=$?
fi
set -e

# Mostrar saída filtrando mensagens de IGNORED_BUILDS (são avisos, não erros fatais)
echo "$_pnpm_out" \
  | grep -v "ERR_PNPM_IGNORED_BUILDS\|Run \"pnpm approve-builds\"" \
  | tail -6 || true

# ERR_PNPM_IGNORED_BUILDS: pacotes estão instalados — esbuild usa optional deps, não postinstall
if [ $_pnpm_ec -ne 0 ] && ! echo "$_pnpm_out" | grep -q "ERR_PNPM_IGNORED_BUILDS"; then
  error "pnpm install falhou (código $_pnpm_ec). Verifique a saída acima."
fi
ok "Dependências instaladas"

step "Aplicando schema do banco de dados..."
set +e
_db_out=$(DATABASE_URL="$DATABASE_URL" pnpm --filter @workspace/db run push-force 2>&1); _db_ec=$?
set -e
# Sempre mostrar saída para diagnóstico
echo "$_db_out" | tail -15
if [ $_db_ec -ne 0 ]; then
  error "Falha ao aplicar schema do banco (código $_db_ec). Verifique as últimas linhas acima."
fi
ok "Schema do banco de dados aplicado"

# ── Build frontend ────────────────────────────────────────────
step "Fazendo build do frontend..."
set +e
_fe_out=$(BASE_PATH=/ PORT=3000 NODE_ENV=production \
  pnpm --filter @workspace/vps-drive run build 2>&1); _fe_ec=$?
set -e
echo "$_fe_out" | tail -8
if [ $_fe_ec -ne 0 ]; then
  error "Falha no build do frontend (código $_fe_ec). Verifique as últimas linhas acima."
fi
ok "Frontend compilado"

# ── Build backend ─────────────────────────────────────────────
step "Fazendo build do servidor..."
set +e
_be_out=$(pnpm --filter @workspace/api-server run build 2>&1); _be_ec=$?
set -e
echo "$_be_out" | tail -5
if [ $_be_ec -ne 0 ]; then
  error "Falha no build do servidor (código $_be_ec). Verifique as últimas linhas acima."
fi
ok "Servidor compilado"

# ── Configurar Nginx ─────────────────────────────────────────
step "Configurando Nginx..."
cat > /etc/nginx/sites-available/vps-drive <<NGINX
server {
    listen 80;
    server_name $VPS_HOST;

    client_max_body_size 500M;

    location = /index.html {
        root $INSTALL_DIR/artifacts/vps-drive/dist/public;
        add_header Cache-Control "no-store, no-cache, must-revalidate";
        add_header Pragma "no-cache";
        expires 0;
    }

    location / {
        root $INSTALL_DIR/artifacts/vps-drive/dist/public;
        try_files \$uri \$uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://localhost:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 300;
        proxy_connect_timeout 300;
        proxy_send_timeout 300;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/vps-drive /etc/nginx/sites-enabled/vps-drive
rm -f /etc/nginx/sites-enabled/default

nginx -t 2>&1 && systemctl reload nginx
ok "Nginx configurado e recarregado"

# ── Certbot / HTTPS ───────────────────────────────────────────
if [[ "$USE_HTTPS" == "true" ]]; then
  step "Instalando Certbot e plugin Nginx..."
  apt-get install -y -qq certbot python3-certbot-nginx
  ok "Certbot instalado"

  step "Obtendo certificado TLS para $VPS_HOST..."
  certbot --nginx \
    --non-interactive \
    --agree-tos \
    --redirect \
    --email "$CERTBOT_EMAIL" \
    -d "$VPS_HOST"
  ok "Certificado emitido e Nginx reconfigurado com HTTPS"

  # Renovação automática via cron (certbot post-install já cria timer systemd,
  # mas adicionamos fallback cron para sistemas sem systemd timers)
  if ! systemctl is-active --quiet certbot.timer 2>/dev/null; then
    (crontab -l 2>/dev/null; echo "0 3 * * * certbot renew --quiet --nginx") | crontab -
    ok "Renovação automática agendada via cron"
  else
    ok "Renovação automática via systemd timer (certbot.timer) já ativa"
  fi
fi

# ── Docker + OnlyOffice Document Server ──────────────────────
if [[ "${WANT_ONLYOFFICE,,}" == "s" ]]; then
  step "Instalando Docker..."
  if command -v docker &>/dev/null; then
    ok "Docker já está instalado ($(docker --version))"
  else
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
    ok "Docker instalado"
  fi

  step "Iniciando OnlyOffice Document Server (pode demorar alguns minutos)..."
  if docker ps -a --format '{{.Names}}' | grep -q '^onlyoffice$'; then
    docker start onlyoffice 2>/dev/null || true
    ok "Container onlyoffice já existia — iniciado"
  else
    docker run -d \
      --name onlyoffice \
      --restart=unless-stopped \
      -p 8080:80 \
      onlyoffice/documentserver
    ok "Container onlyoffice criado e iniciado"
  fi

  echo "  Aguardando OnlyOffice ficar disponível (pode levar 1-2 minutos)..."
  OO_OK=false
  for i in $(seq 1 24); do
    sleep 5
    OO_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:8080/healthcheck" 2>/dev/null || echo "000")
    if [[ "$OO_STATUS" == "200" ]]; then
      OO_OK=true
      ok "OnlyOffice disponível: http://localhost:8080"
      break
    fi
    echo "  Tentativa $i/24: HTTP $OO_STATUS — aguardando..."
  done
  if [[ "$OO_OK" != "true" ]]; then
    warn "OnlyOffice não respondeu no tempo esperado. Verifique: docker logs onlyoffice"
    warn "O VPS Drive funcionará normalmente — o botão Editar aparecerá quando o servidor estiver pronto."
  fi
fi

# ── Iniciar com PM2 ───────────────────────────────────────────
step "Iniciando servidor com PM2..."
pm2 stop vps-drive-api 2>/dev/null || true
pm2 delete vps-drive-api 2>/dev/null || true

# Carregar variáveis do .env para o processo PM2
set -a
# shellcheck source=/dev/null
source "$INSTALL_DIR/.env"
set +a

pm2 start "$INSTALL_DIR/artifacts/api-server/dist/index.mjs" \
  --name "vps-drive-api" \
  --cwd "$INSTALL_DIR"

pm2 save
# Configurar startup automático
STARTUP_CMD=$(pm2 startup 2>&1 | grep "^sudo" | head -1)
if [[ -n "$STARTUP_CMD" ]]; then
  eval "$STARTUP_CMD" 2>/dev/null || true
fi
ok "Servidor iniciado com PM2"

# ── Verificação pós-instalação ────────────────────────────────
step "Verificando saúde do servidor (healthz interno)..."
echo "  Aguardando o servidor iniciar..."
HEALTH_OK=false
for i in $(seq 1 20); do
  sleep 3
  HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$APP_PORT/api/healthz" 2>/dev/null || echo "000")
  if [[ "$HTTP_STATUS" == "200" ]]; then
    HEALTH_OK=true
    ok "Servidor interno respondendo: http://localhost:$APP_PORT/api/healthz → HTTP $HTTP_STATUS"
    break
  fi
  echo "  Tentativa $i/20: HTTP $HTTP_STATUS — aguardando..."
done
if [[ "$HEALTH_OK" != "true" ]]; then
  echo ""
  pm2 logs vps-drive-api --lines 20 --nostream 2>/dev/null || true
  error "Servidor não iniciou em tempo. Veja os logs acima e corrija antes de continuar."
fi

step "Verificando conectividade com o banco de dados..."
DB_STATUS_CODE=$(curl -s -o /tmp/db_health.json -w "%{http_code}" "http://localhost:$APP_PORT/api/healthz/db" 2>/dev/null || echo "000")
DB_STATUS_BODY=$(cat /tmp/db_health.json 2>/dev/null || echo "")
if [[ "$DB_STATUS_CODE" == "200" ]]; then
  ok "Banco de dados acessível: $DB_STATUS_BODY"
else
  echo "  Resposta do servidor: $DB_STATUS_BODY"
  error "Banco de dados inacessível (HTTP $DB_STATUS_CODE). Verifique DATABASE_URL e as permissões do banco."
fi

step "Verificando resposta do Nginx (URL pública)..."
if [[ "$USE_HTTPS" == "true" ]]; then
  PUBLIC_PROTO="https"
else
  PUBLIC_PROTO="http"
fi
NGINX_API_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$PUBLIC_PROTO://$VPS_HOST/api/healthz" 2>/dev/null || echo "000")
if [[ "$NGINX_API_STATUS" == "200" ]]; then
  ok "Nginx roteia /api/ corretamente: $PUBLIC_PROTO://$VPS_HOST/api/healthz → HTTP $NGINX_API_STATUS"
else
  error "Nginx não está roteando /api/ corretamente (HTTP $NGINX_API_STATUS). Verifique: nginx -t && systemctl status nginx"
fi

NGINX_FRONTEND_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$PUBLIC_PROTO://$VPS_HOST/" 2>/dev/null || echo "000")
if [[ "$NGINX_FRONTEND_STATUS" == "200" ]]; then
  ok "Nginx serve o frontend: $PUBLIC_PROTO://$VPS_HOST/ → HTTP $NGINX_FRONTEND_STATUS"
else
  error "Nginx não está servindo o frontend (HTTP $NGINX_FRONTEND_STATUS). Verifique /etc/nginx/sites-available/vps-drive"
fi

echo ""
pm2 status vps-drive-api

# ── Smoke test: criar admin, login, upload e download ─────────
step "Smoke test: criando usuário administrador e verificando upload/download..."

# Criar usuário master
SETUP_RESP=$(curl -s -w "\n%{http_code}" -X POST "http://localhost:$APP_PORT/api/setup/create-master" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"$ADMIN_NAME\",\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" 2>/dev/null)
SETUP_CODE=$(echo "$SETUP_RESP" | tail -1)
SETUP_BODY=$(echo "$SETUP_RESP" | head -1)
if [[ "$SETUP_CODE" == "201" ]]; then
  ok "Usuário administrador criado: $ADMIN_EMAIL"
elif [[ "$SETUP_CODE" == "403" ]]; then
  echo "  Instalação anterior detectada — atualizando credenciais do administrador..."
  PASS_HASH=$(node -e "
const b = require('bcryptjs');
b.hash(process.argv[1], 10).then(h => process.stdout.write(h)).catch(() => process.exit(1));
" "$ADMIN_PASSWORD" 2>/dev/null)
  if [[ -z "$PASS_HASH" ]]; then
    error "Falha ao gerar hash da senha. Certifique-se de que bcryptjs está instalado."
  fi
  ADMIN_EMAIL_LOWER=$(echo "$ADMIN_EMAIL" | tr '[:upper:]' '[:lower:]')
  psql "$DATABASE_URL" -c "UPDATE users SET name='$ADMIN_NAME', email='$ADMIN_EMAIL_LOWER', password_hash='$PASS_HASH', is_active=true WHERE role='master';" >/dev/null 2>&1
  ok "Credenciais do administrador atualizadas: $ADMIN_EMAIL"
else
  error "Falha ao criar usuário administrador (HTTP $SETUP_CODE): $SETUP_BODY"
fi

# Login e captura do cookie de sessão
LOGIN_COOKIE_HEADER=$(curl -si -X POST "http://localhost:$APP_PORT/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" 2>/dev/null \
  | grep -i "set-cookie:" | head -1 | sed 's/.*connect\.sid=\([^;]*\).*/connect.sid=\1/')
SESSION_DECODED=$(python3 -c "import urllib.parse; print(urllib.parse.unquote('$LOGIN_COOKIE_HEADER'))" 2>/dev/null || echo "$LOGIN_COOKIE_HEADER")
if [[ -z "$SESSION_DECODED" ]]; then
  error "Login falhou — cookie de sessão não foi recebido. Verifique SESSION_SECRET no .env"
fi
ok "Login bem-sucedido, sessão ativa"

# Verificar /auth/me com a sessão
ME_CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "Cookie: $SESSION_DECODED" \
  "http://localhost:$APP_PORT/api/auth/me" 2>/dev/null || echo "000")
if [[ "$ME_CODE" == "200" ]]; then
  ok "Sessão autenticada confirmada via /auth/me"
else
  error "Sessão inválida (/auth/me retornou HTTP $ME_CODE). Verifique connect-pg-simple e a tabela sessions."
fi

# Upload de arquivo de teste
SMOKE_FILE=$(mktemp)
echo "vps-drive-smoke-test-$(date +%s)" > "$SMOKE_FILE"
SMOKE_CONTENT=$(cat "$SMOKE_FILE")
UPLOAD_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Cookie: $SESSION_DECODED" \
  -F "files=@$SMOKE_FILE;filename=.vps-smoke-test.tmp" \
  -F "path=" \
  "http://localhost:$APP_PORT/api/files/upload" 2>/dev/null || echo "000")
rm -f "$SMOKE_FILE"
if [[ "$UPLOAD_CODE" == "200" ]]; then
  ok "Upload de arquivo verificado (HTTP $UPLOAD_CODE)"
else
  error "Falha no upload de arquivo (HTTP $UPLOAD_CODE)"
fi

# Download e verificação do conteúdo
DOWNLOADED=$(curl -s -H "Cookie: $SESSION_DECODED" \
  "http://localhost:$APP_PORT/api/files/download?path=.vps-smoke-test.tmp" 2>/dev/null)
if [[ "$DOWNLOADED" == "$SMOKE_CONTENT" ]]; then
  ok "Download verificado — conteúdo idêntico ao upload"
else
  error "Falha na verificação do download (conteúdo não confere)"
fi

# Limpeza do arquivo de teste
curl -s -o /dev/null -X DELETE -H "Cookie: $SESSION_DECODED" \
  "http://localhost:$APP_PORT/api/files?.vps-smoke-test.tmp" 2>/dev/null || true
curl -s -o /dev/null -X DELETE -H "Cookie: $SESSION_DECODED" \
  "http://localhost:$APP_PORT/api/files?path=.vps-smoke-test.tmp" 2>/dev/null || true

ok "Smoke test concluído — login, upload e download funcionando corretamente"

# ── Mensagem final ───────────────────────────────────────────
if [[ "$USE_HTTPS" == "true" ]]; then
  PROTO="https"
else
  PROTO="http"
fi

echo -e "
${BOLD}${GREEN}╔══════════════════════════════════════════════════╗
║        ✅  Instalação concluída com sucesso!      ║
╚══════════════════════════════════════════════════╝${NC}

${BOLD}Próximos passos:${NC}

  1. Acesse o VPS Drive: ${CYAN}${PROTO}://$VPS_HOST${NC}
  2. Faça login com o e-mail: ${CYAN}$ADMIN_EMAIL${NC}

${BOLD}Comandos úteis:${NC}
  pm2 status                  — status do servidor
  pm2 logs vps-drive-api      — logs em tempo real
  pm2 restart vps-drive-api   — reiniciar o servidor
"
