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

read -rp "Pasta para guardar os arquivos [/data/vps-drive]: " STORAGE_PATH
STORAGE_PATH="${STORAGE_PATH:-/data/vps-drive}"

read -rp "Porta do servidor interno [5000]: " APP_PORT
APP_PORT="${APP_PORT:-5000}"

read -rp "Pasta de instalação do app [/opt/vps-drive]: " INSTALL_DIR
INSTALL_DIR="${INSTALL_DIR:-/opt/vps-drive}"

echo ""
echo -e "${BOLD}Chaves do Clerk (necessárias para autenticação):${NC}"
echo -e "${YELLOW}Obtenha em: https://dashboard.clerk.com → seu app → API Keys${NC}"
read -rp "CLERK_PUBLISHABLE_KEY (pk_live_...): " CLERK_PUB_KEY
read -rsp "CLERK_SECRET_KEY (sk_live_...): " CLERK_SECRET_KEY
echo ""

[[ -z "$CLERK_PUB_KEY" ]] && error "CLERK_PUBLISHABLE_KEY é obrigatória."
[[ -z "$CLERK_SECRET_KEY" ]] && error "CLERK_SECRET_KEY é obrigatória."

# ── Resumo ───────────────────────────────────────────────────
echo -e "\n${BOLD}Resumo:${NC}"
echo "  Host:              $VPS_HOST"
echo "  Armazenamento:     $STORAGE_PATH"
echo "  Porta interna:     $APP_PORT"
echo "  Diretório do app:  $INSTALL_DIR"
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
  ok "pnpm $(pnpm --version) já está instalado"
else
  npm install -g pnpm --quiet
  ok "pnpm instalado"
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

# Detectar modo: (1) executado de dentro do projeto, (2) INSTALL_DIR já existe, (3) clonar
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-./install.sh}")" 2>/dev/null && pwd || echo "")"
PROJECT_ROOT=""

# Verificar se o script está dentro do projeto
if [[ -n "$SCRIPT_DIR" && -f "$SCRIPT_DIR/../package.json" ]]; then
  PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
elif [[ -f "$PWD/package.json" ]]; then
  PROJECT_ROOT="$PWD"
fi

if [[ -n "$PROJECT_ROOT" ]]; then
  echo "  Projeto encontrado em: $PROJECT_ROOT"
  if [[ "$PROJECT_ROOT" != "$INSTALL_DIR" ]]; then
    echo "  Copiando arquivos para $INSTALL_DIR..."
    mkdir -p "$INSTALL_DIR"
    rsync -a --exclude='node_modules' --exclude='.git' --exclude='*/dist' \
      "$PROJECT_ROOT/" "$INSTALL_DIR/"
  fi
  ok "Código localizado em $INSTALL_DIR"
elif [[ -f "$INSTALL_DIR/package.json" ]]; then
  echo "  Instalação existente detectada em $INSTALL_DIR"
  ok "Usando código existente em $INSTALL_DIR"
else
  # Último recurso: pedir URL do repositório git
  echo ""
  echo -e "${YELLOW}Não foi encontrado o código do projeto localmente.${NC}"
  read -rp "URL do repositório git para clonar: " GIT_REPO
  [[ -z "$GIT_REPO" ]] && error "URL do repositório é necessária quando o projeto não está presente localmente."
  echo "  Clonando $GIT_REPO..."
  git clone "$GIT_REPO" "$INSTALL_DIR"
  ok "Repositório clonado em $INSTALL_DIR"
fi

cd "$INSTALL_DIR"

# ── Arquivo .env ─────────────────────────────────────────────
step "Gerando arquivo .env..."
cat > "$INSTALL_DIR/.env" <<EOF
STORAGE_PATH=$STORAGE_PATH
PORT=$APP_PORT
CLERK_PUBLISHABLE_KEY=$CLERK_PUB_KEY
CLERK_SECRET_KEY=$CLERK_SECRET_KEY
VITE_CLERK_PUBLISHABLE_KEY=$CLERK_PUB_KEY
BASE_PATH=/
NODE_ENV=production
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
pnpm install --frozen-lockfile 2>&1 | tail -3
ok "Dependências instaladas"

# ── Build frontend ────────────────────────────────────────────
step "Fazendo build do frontend..."
BASE_PATH=/ PORT=3000 NODE_ENV=production \
  pnpm --filter @workspace/vps-drive run build 2>&1 | tail -5
ok "Frontend compilado"

# ── Build backend ─────────────────────────────────────────────
step "Fazendo build do servidor..."
pnpm --filter @workspace/api-server run build 2>&1 | tail -5
ok "Servidor compilado"

# ── Configurar Nginx ─────────────────────────────────────────
step "Configurando Nginx..."
cat > /etc/nginx/sites-available/vps-drive <<NGINX
server {
    listen 80;
    server_name $VPS_HOST;

    client_max_body_size 500M;

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

# ── Mensagem final ───────────────────────────────────────────
echo -e "
${BOLD}${GREEN}╔══════════════════════════════════════════════════╗
║        ✅  Instalação concluída com sucesso!      ║
╚══════════════════════════════════════════════════╝${NC}

${BOLD}Próximos passos:${NC}

  1. Abra no navegador: ${CYAN}http://$VPS_HOST/setup${NC}
  2. Crie o usuário administrador (nome, e-mail e senha)
  3. Após criação, faça login em: ${CYAN}http://$VPS_HOST${NC}

${BOLD}Comandos úteis:${NC}
  pm2 status                  — status do servidor
  pm2 logs vps-drive-api      — logs em tempo real
  pm2 restart vps-drive-api   — reiniciar o servidor

${YELLOW}Dica: Para HTTPS com Let's Encrypt, consulte DEPLOY.md (seção 9).${NC}
"
