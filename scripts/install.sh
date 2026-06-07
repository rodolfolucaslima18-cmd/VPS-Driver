#!/usr/bin/env bash
# ============================================================
#  VPS Drive — Instalador Interativo
#  Compatível com Ubuntu 20.04+ / Debian 11+
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
echo -e "Este script vai instalar e configurar o VPS Drive na sua VPS."
echo -e "Requisitos: Ubuntu 20.04+ ou Debian 11+\n"

# ── Verificar sistema operacional ────────────────────────────
step "Verificando sistema operacional..."
if [[ -f /etc/os-release ]]; then
  . /etc/os-release
  if [[ "$ID" != "ubuntu" && "$ID" != "debian" && "$ID_LIKE" != *"debian"* ]]; then
    error "Sistema não suportado: $PRETTY_NAME. Use Ubuntu 20.04+ ou Debian 11+."
  fi
  ok "Sistema compatível: $PRETTY_NAME"
else
  error "Não foi possível identificar o sistema operacional."
fi

# ── Verificar root ───────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
  error "Execute este instalador como root: sudo bash install.sh"
fi

# ── Perguntas de configuração ────────────────────────────────
echo -e "\n${BOLD}Configuração da instalação${NC}"
echo "Responda as perguntas abaixo (pressione Enter para usar o valor padrão):"
echo ""

read -rp "IP ou domínio da VPS (ex: 192.168.1.1 ou meusite.com): " VPS_HOST
[[ -z "$VPS_HOST" ]] && error "O IP ou domínio é obrigatório."

read -rp "Pasta para guardar os arquivos [/data/vps-drive]: " STORAGE_PATH
STORAGE_PATH="${STORAGE_PATH:-/data/vps-drive}"

read -rp "Porta do servidor interno [5000]: " APP_PORT
APP_PORT="${APP_PORT:-5000}"

read -rp "URL do repositório git (deixe em branco para usar diretório atual): " GIT_REPO
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
echo -e "\n${BOLD}Resumo da instalação:${NC}"
echo "  Host:              $VPS_HOST"
echo "  Armazenamento:     $STORAGE_PATH"
echo "  Porta interna:     $APP_PORT"
echo "  Diretório do app:  $INSTALL_DIR"
echo ""
read -rp "Confirmar instalação? [s/N]: " CONFIRM
[[ "${CONFIRM,,}" != "s" ]] && { echo "Instalação cancelada."; exit 0; }

# ── Atualizar apt ─────────────────────────────────────────────
step "Atualizando lista de pacotes..."
apt-get update -qq
ok "Lista de pacotes atualizada"

# ── Instalar curl e git ───────────────────────────────────────
step "Instalando ferramentas básicas (curl, git)..."
apt-get install -y -qq curl git
ok "curl e git instalados"

# ── Node.js 22 LTS ───────────────────────────────────────────
step "Verificando Node.js..."
if command -v node &>/dev/null && node --version | grep -q "^v2[2-9]"; then
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
  echo "  Instalando pnpm..."
  npm install -g pnpm --quiet
  ok "pnpm $(pnpm --version) instalado"
fi

# ── PM2 ─────────────────────────────────────────────────────
step "Verificando PM2..."
if command -v pm2 &>/dev/null; then
  ok "PM2 $(pm2 --version) já está instalado"
else
  echo "  Instalando PM2..."
  npm install -g pm2 --quiet
  ok "PM2 instalado"
fi

# ── Nginx ────────────────────────────────────────────────────
step "Verificando Nginx..."
if command -v nginx &>/dev/null; then
  ok "Nginx já está instalado"
else
  echo "  Instalando Nginx..."
  apt-get install -y -qq nginx
  ok "Nginx instalado"
fi

# ── Código do app ────────────────────────────────────────────
step "Obtendo código do VPS Drive..."
if [[ -n "$GIT_REPO" ]]; then
  echo "  Clonando repositório: $GIT_REPO"
  if [[ -d "$INSTALL_DIR" ]]; then
    warn "Diretório $INSTALL_DIR já existe. Atualizando..."
    cd "$INSTALL_DIR" && git pull
  else
    git clone "$GIT_REPO" "$INSTALL_DIR"
  fi
  ok "Repositório clonado em $INSTALL_DIR"
else
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
  if [[ -f "$PROJECT_ROOT/package.json" ]]; then
    echo "  Copiando arquivos locais de $PROJECT_ROOT para $INSTALL_DIR..."
    mkdir -p "$INSTALL_DIR"
    rsync -a --exclude='node_modules' --exclude='.git' --exclude='dist' \
      "$PROJECT_ROOT/" "$INSTALL_DIR/"
    ok "Arquivos copiados para $INSTALL_DIR"
  else
    error "Nenhum repositório git informado e não foi encontrado projeto local. Informe uma URL de repositório."
  fi
fi

cd "$INSTALL_DIR"

# ── Instalar dependências ────────────────────────────────────
step "Instalando dependências (pnpm install)..."
pnpm install --frozen-lockfile 2>&1 | tail -3
ok "Dependências instaladas"

# ── Arquivo .env ─────────────────────────────────────────────
step "Gerando arquivo .env..."
cat > "$INSTALL_DIR/.env" <<EOF
STORAGE_PATH=$STORAGE_PATH
PORT=$APP_PORT
CLERK_PUBLISHABLE_KEY=$CLERK_PUB_KEY
CLERK_SECRET_KEY=$CLERK_SECRET_KEY
VITE_CLERK_PUBLISHABLE_KEY=$CLERK_PUB_KEY
NODE_ENV=production
EOF
chmod 600 "$INSTALL_DIR/.env"
ok "Arquivo .env criado"

# ── Diretório de armazenamento ───────────────────────────────
step "Criando diretório de armazenamento..."
mkdir -p "$STORAGE_PATH"
chmod 755 "$STORAGE_PATH"
ok "Diretório criado: $STORAGE_PATH"

# ── Build frontend ────────────────────────────────────────────
step "Fazendo build do frontend..."
pnpm --filter @workspace/vps-drive run build 2>&1 | tail -5
ok "Frontend compilado"

# ── Build backend ─────────────────────────────────────────────
step "Fazendo build do servidor..."
pnpm --filter @workspace/api-server run build 2>&1 | tail -5
ok "Servidor compilado"

# ── Configurar Nginx ─────────────────────────────────────────
step "Configurando Nginx..."
cat > /etc/nginx/sites-available/vps-drive <<EOF
server {
    listen 80;
    server_name $VPS_HOST;

    client_max_body_size 500M;

    # Frontend estático
    location / {
        root $INSTALL_DIR/artifacts/vps-drive/dist/public;
        try_files \$uri \$uri/ /index.html;
    }

    # API Node.js
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
EOF

# Ativar site
ln -sf /etc/nginx/sites-available/vps-drive /etc/nginx/sites-enabled/vps-drive
# Remover default se existir
rm -f /etc/nginx/sites-enabled/default

nginx -t 2>&1 && systemctl reload nginx
ok "Nginx configurado e recarregado"

# ── Iniciar com PM2 ───────────────────────────────────────────
step "Iniciando servidor com PM2..."
cd "$INSTALL_DIR"

# Parar instância anterior se existir
pm2 stop vps-drive-api 2>/dev/null || true
pm2 delete vps-drive-api 2>/dev/null || true

# Iniciar novo processo
env $(cat .env | grep -v '^#' | xargs) \
  pm2 start artifacts/api-server/dist/index.mjs \
  --name "vps-drive-api" \
  --cwd "$INSTALL_DIR"

pm2 save
pm2 startup 2>&1 | tail -5
ok "Servidor iniciado com PM2"

# ── Mensagem final ───────────────────────────────────────────
echo -e "
${BOLD}${GREEN}╔══════════════════════════════════════════════════╗
║        ✅  Instalação concluída com sucesso!      ║
╚══════════════════════════════════════════════════╝${NC}

${BOLD}Próximos passos:${NC}

  1. Acesse no navegador: ${CYAN}http://$VPS_HOST/setup${NC}
  2. Crie o usuário administrador (nome, e-mail e senha)
  3. Após criar o usuário, faça login em: ${CYAN}http://$VPS_HOST${NC}

${BOLD}Comandos úteis:${NC}
  pm2 status             — ver status do servidor
  pm2 logs vps-drive-api — ver logs em tempo real
  pm2 restart vps-drive-api — reiniciar o servidor

${YELLOW}Dica: Para ativar HTTPS, consulte DEPLOY.md (seção 9 — Certbot).${NC}
"
