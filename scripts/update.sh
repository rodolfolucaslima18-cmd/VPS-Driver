#!/usr/bin/env bash
# ============================================================
#  VPS Drive — Script de Atualização
#  Detecta automaticamente instalação via Docker Compose ou PM2
#  e executa o procedimento correto para cada uma.
#
#  Uso:
#    sudo bash scripts/update.sh
#    curl -fsSL https://raw.githubusercontent.com/rodolfolucaslima18-cmd/VPS-Driver/main/scripts/update.sh | sudo bash
# ============================================================
set -euo pipefail

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

DEFAULT_GIT_REPO="https://github.com/rodolfolucaslima18-cmd/VPS-Driver.git"
REPO_PLACEHOLDER="__REPO_URL__"
BRANCH_PLACEHOLDER="__REPO_BRANCH__"
GIT_REPO="${VPS_DRIVE_REPO_URL:-__REPO_URL__}"
GIT_BRANCH="${VPS_DRIVE_REPO_BRANCH:-__REPO_BRANCH__}"

[[ -z "$GIT_REPO"    || "$GIT_REPO"    == "$REPO_PLACEHOLDER"   ]] && GIT_REPO="$DEFAULT_GIT_REPO"
[[ -z "$GIT_BRANCH"  || "$GIT_BRANCH"  == "$BRANCH_PLACEHOLDER" ]] && GIT_BRANCH="main"
GIT_REPO="${GIT_REPO%/}"

echo -e "
${BOLD}${CYAN}╔══════════════════════════════════════╗
║       VPS Drive — Atualização        ║
╚══════════════════════════════════════╝${NC}
"

# ── Verificar root ───────────────────────────────────────────
[[ $EUID -ne 0 ]] && error "Execute como root: sudo bash update.sh"

# ── Localizar instalação ─────────────────────────────────────
step "Localizando instalação do VPS Drive..."

INSTALL_DIR="${VPS_DRIVE_DIR:-/opt/vps-drive}"

# Aceita instalação Docker (sem package.json no host) ou PM2 (com package.json)
if [[ ! -f "$INSTALL_DIR/docker-compose.yml" && ! -f "$INSTALL_DIR/package.json" ]]; then
  error "VPS Drive não encontrado em $INSTALL_DIR. Verifique VPS_DRIVE_DIR ou instale primeiro."
fi
ok "Instalação encontrada em $INSTALL_DIR"

# ── Detectar tipo de instalação ──────────────────────────────
step "Detectando tipo de instalação..."

INSTALL_TYPE="unknown"

if [[ -f "$INSTALL_DIR/docker-compose.yml" ]] && command -v docker &>/dev/null; then
  # Verificar se containers do VPS Drive existem
  if docker compose -f "$INSTALL_DIR/docker-compose.yml" ps --quiet 2>/dev/null | grep -q .; then
    INSTALL_TYPE="docker"
  elif [[ ! -f "$INSTALL_DIR/package.json" ]]; then
    # docker-compose.yml existe mas containers não rodando — ainda é Docker
    INSTALL_TYPE="docker"
  fi
fi

if [[ "$INSTALL_TYPE" == "unknown" && -f "$INSTALL_DIR/package.json" ]]; then
  INSTALL_TYPE="pm2"
fi

case "$INSTALL_TYPE" in
  docker) ok "Instalação Docker Compose detectada" ;;
  pm2)    ok "Instalação PM2 detectada" ;;
  *)      error "Não foi possível determinar o tipo de instalação. Verifique $INSTALL_DIR." ;;
esac

# ============================================================
#  MODO DOCKER COMPOSE
# ============================================================
update_docker() {
  ENV_FILE="$INSTALL_DIR/.env"
  [[ ! -f "$ENV_FILE" ]] && error "Arquivo .env não encontrado em $ENV_FILE."

  step "Reconstruindo imagem Docker com código atualizado..."
  cd "$INSTALL_DIR"

  # Rebuild sem derrubar o banco (apenas app e nginx sobem novamente)
  docker compose build app
  ok "Imagem reconstruída"

  step "Reiniciando containers..."
  docker compose up -d --no-deps app nginx
  ok "Containers atualizados"

  step "Verificando saúde do servidor..."
  echo "  Aguardando inicialização..."
  for i in $(seq 1 20); do
    sleep 5
    # Verifica saúde via docker inspect (funciona de dentro do container via socket)
    APP_ID=$(docker compose ps -q app 2>/dev/null | head -1)
    if [[ -n "$APP_ID" ]]; then
      HEALTH=$(docker inspect --format='{{.State.Health.Status}}' "$APP_ID" 2>/dev/null || echo "unknown")
      if [[ "$HEALTH" == "healthy" ]]; then
        ok "Servidor saudável (container: ${APP_ID:0:12})"
        break
      fi
    else
      HEALTH="sem container"
    fi
    if [[ $i -eq 20 ]]; then
      docker compose logs app --tail=20 2>/dev/null || true
      error "Servidor não ficou saudável após atualização. Veja os logs acima."
    fi
    echo "  Tentativa $i/20: health=$HEALTH — aguardando..."
  done

  docker compose ps
}

# ============================================================
#  MODO PM2
# ============================================================
update_pm2() {
  ENV_FILE="$INSTALL_DIR/.env"
  [[ ! -f "$ENV_FILE" ]] && error "Arquivo .env não encontrado em $ENV_FILE."

  APP_PORT=$(grep "^PORT=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- || echo "5000")
  APP_PORT="${APP_PORT:-5000}"
  STORAGE_PATH=$(grep "^STORAGE_PATH=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- || echo "/data/vps-drive")
  STORAGE_PATH="${STORAGE_PATH:-/data/vps-drive}"

  ok "Configuração carregada (porta: $APP_PORT)"

  # ── Buscar código novo ──────────────────────────────────────
  step "Buscando código atualizado no GitHub ($GIT_BRANCH)..."

  command -v git &>/dev/null || error "Git não instalado. Execute: apt-get install -y git"

  if ! [[ "$GIT_REPO" =~ ^https://github\.com/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+(\.git)?$ ||
          "$GIT_REPO" =~ ^git@github\.com:[A-Za-z0-9._-]+/[A-Za-z0-9._-]+(\.git)?$ ]]; then
    error "Repositório inválido: $GIT_REPO"
  fi

  if ! [[ "$GIT_BRANCH" =~ ^[A-Za-z0-9._/-]+$ ]] ||
     [[ "$GIT_BRANCH" == -* || "$GIT_BRANCH" == *".."* || "$GIT_BRANCH" == *"//"* ]]; then
    error "Branch inválida: $GIT_BRANCH"
  fi

  TMPDIR_UPDATE=$(mktemp -d)
  trap 'rm -rf "$TMPDIR_UPDATE"' EXIT

  cp "$ENV_FILE" "$TMPDIR_UPDATE/.env.bak"

  INSTALL_DIR_ABS=$(realpath -m "$INSTALL_DIR")
  if [[ "$STORAGE_PATH" = /* ]]; then
    STORAGE_DIR=$(realpath -m "$STORAGE_PATH")
  else
    STORAGE_DIR=$(realpath -m "$INSTALL_DIR_ABS/$STORAGE_PATH")
  fi

  STORAGE_BACKUP_DIR="$TMPDIR_UPDATE/storage.bak"
  STORAGE_BACKUP_READY=false
  [[ "$STORAGE_DIR" == "$INSTALL_DIR_ABS" ]] && error "STORAGE_PATH não pode ser o diretório de instalação."
  if [[ "$STORAGE_DIR" == "$INSTALL_DIR_ABS/"* && -d "$STORAGE_DIR" ]]; then
    mkdir -p "$STORAGE_BACKUP_DIR"
    cp -a "$STORAGE_DIR/." "$STORAGE_BACKUP_DIR/"
    STORAGE_BACKUP_READY=true
    ok "Backup dos arquivos enviados criado"
  fi

  if [[ -d "$INSTALL_DIR/.git" ]]; then
    echo "  Atualizando repositório existente..."
    git -C "$INSTALL_DIR" remote set-url origin "$GIT_REPO" 2>/dev/null || \
      git -C "$INSTALL_DIR" remote add origin "$GIT_REPO"
    git -C "$INSTALL_DIR" fetch --depth 1 origin "$GIT_BRANCH"
    git -C "$INSTALL_DIR" checkout --force -B "$GIT_BRANCH" FETCH_HEAD
    git -C "$INSTALL_DIR" reset --hard FETCH_HEAD
  else
    echo "  Clonando repositório..."
    SOURCE_DIR="$TMPDIR_UPDATE/repository"
    git clone --depth 1 --branch "$GIT_BRANCH" "$GIT_REPO" "$SOURCE_DIR"
    rsync -a --delete \
      --exclude='.env' \
      --exclude='node_modules' \
      --exclude='storage' \
      --exclude='artifacts/api-server/dist' \
      --exclude='artifacts/vps-drive/dist' \
      "$SOURCE_DIR/" "$INSTALL_DIR/"
  fi

  # Garantir que .env não foi sobrescrito
  if [[ ! -f "$ENV_FILE" ]] || ! cmp -s "$ENV_FILE" "$TMPDIR_UPDATE/.env.bak"; then
    cp "$TMPDIR_UPDATE/.env.bak" "$ENV_FILE"
    warn ".env restaurado do backup"
  fi

  [[ "$STORAGE_BACKUP_READY" == true ]] && { mkdir -p "$STORAGE_DIR"; cp -a "$STORAGE_BACKUP_DIR/." "$STORAGE_DIR/"; ok "Arquivos enviados restaurados"; }
  ok "Código da branch $GIT_BRANCH aplicado"

  cd "$INSTALL_DIR"

  # ── pnpm ──────────────────────────────────────────────────
  step "Verificando pnpm..."
  if command -v pnpm &>/dev/null; then
    PNPM_MAJOR=$(pnpm --version 2>/dev/null | cut -d. -f1)
    if [ "${PNPM_MAJOR:-0}" -ge 11 ]; then
      echo "  pnpm v$(pnpm --version) — downgrade para v10..."
      npm install -g pnpm@10 --quiet 2>&1 | tail -2; hash -r
      ok "pnpm $(pnpm --version) (v10)"
    else
      ok "pnpm $(pnpm --version)"
    fi
  else
    npm install -g pnpm@10 --quiet
    ok "pnpm $(pnpm --version) instalado"
  fi

  # ── Dependências ──────────────────────────────────────────
  step "Instalando dependências..."
  printf '{"onlyBuiltDependencies":["@swc/core","esbuild","msw","unrs-resolver"]}\n' > pnpm.json
  grep -q "minimum-release-age" .npmrc 2>/dev/null || echo "minimum-release-age=0" >> .npmrc
  grep -q "onlyBuiltDependencies" .npmrc 2>/dev/null || {
    echo "onlyBuiltDependencies[]=@swc/core" >> .npmrc
    echo "onlyBuiltDependencies[]=esbuild" >> .npmrc
    echo "onlyBuiltDependencies[]=msw" >> .npmrc
    echo "onlyBuiltDependencies[]=unrs-resolver" >> .npmrc
  }

  set +e
  _out=$(pnpm install --frozen-lockfile 2>&1); _ec=$?
  [[ $_ec -ne 0 ]] && { _out=$(pnpm install 2>&1); _ec=$?; }
  set -e
  echo "$_out" | grep -v "ERR_PNPM_IGNORED_BUILDS\|Run \"pnpm approve-builds\"" | tail -4 || true
  [[ $_ec -ne 0 ]] && ! echo "$_out" | grep -q "ERR_PNPM_IGNORED_BUILDS" && error "pnpm install falhou (código $_ec)."
  ok "Dependências instaladas"

  # ── Build ─────────────────────────────────────────────────
  set -a; source "$ENV_FILE" 2>/dev/null || true; set +a

  step "Compilando frontend..."
  set +e
  _fe=$(BASE_PATH=/ PORT=3000 NODE_ENV=production pnpm --filter @workspace/vps-drive run build 2>&1); _fe_ec=$?
  set -e
  echo "$_fe" | tail -6
  [[ $_fe_ec -ne 0 ]] && error "Build do frontend falhou (código $_fe_ec)."
  ok "Frontend compilado"

  step "Compilando servidor..."
  set +e
  _be=$(pnpm --filter @workspace/api-server run build 2>&1); _be_ec=$?
  set -e
  echo "$_be" | tail -4
  [[ $_be_ec -ne 0 ]] && error "Build do servidor falhou (código $_be_ec)."
  ok "Servidor compilado"

  # ── Nginx: patch Cache-Control ────────────────────────────
  NGINX_CONF="/etc/nginx/sites-available/vps-drive"
  if [[ -f "$NGINX_CONF" ]] && ! grep -q "no-store" "$NGINX_CONF"; then
    step "Nginx: aplicando Cache-Control para index.html..."
    TMP_PY=$(mktemp)
    cat > "$TMP_PY" << 'PYEOF'
import sys
conf_path, install_dir = sys.argv[1], sys.argv[2]
with open(conf_path) as f: conf = f.read()
block = (
    '    location = /index.html {\n'
    '        root ' + install_dir + '/artifacts/vps-drive/dist/public;\n'
    '        add_header Cache-Control "no-store, no-cache, must-revalidate";\n'
    '        add_header Pragma "no-cache";\n'
    '        expires 0;\n'
    '    }\n\n'
)
conf = conf.replace('    location / {', block + '    location / {', 1)
with open(conf_path, 'w') as f: f.write(conf)
PYEOF
    python3 "$TMP_PY" "$NGINX_CONF" "$INSTALL_DIR"
    rm -f "$TMP_PY"
    nginx -t 2>&1 && systemctl reload nginx && ok "Nginx atualizado" || warn "Patch Nginx falhou — configuração mantida"
  fi

  # ── PM2 ──────────────────────────────────────────────────
  step "Reiniciando servidor (PM2)..."
  set -a; source "$ENV_FILE"; set +a
  if pm2 describe vps-drive-api &>/dev/null; then
    pm2 reload vps-drive-api --update-env
    ok "vps-drive-api recarregado"
  else
    pm2 start "$INSTALL_DIR/artifacts/api-server/dist/index.mjs" \
      --name "vps-drive-api" --cwd "$INSTALL_DIR"
    pm2 save
    ok "vps-drive-api iniciado"
  fi

  step "Verificando servidor..."
  sleep 4
  for i in $(seq 1 10); do
    HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$APP_PORT/api/healthz" 2>/dev/null || echo "000")
    [[ "$HTTP_STATUS" == "200" ]] && { ok "Servidor respondendo → HTTP 200"; break; }
    [[ $i -eq 10 ]] && { pm2 logs vps-drive-api --lines 15 --nostream 2>/dev/null || true; error "Servidor não respondeu."; }
    echo "  Tentativa $i/10: HTTP $HTTP_STATUS..."; sleep 3
  done
}

# ── Executar modo correto ────────────────────────────────────
case "$INSTALL_TYPE" in
  docker) update_docker ;;
  pm2)    update_pm2   ;;
esac

echo -e "
${BOLD}${GREEN}╔══════════════════════════════════════════════╗
║     ✅  Atualização concluída com sucesso!    ║
╚══════════════════════════════════════════════╝${NC}

  Tipo de instalação: ${BOLD}$INSTALL_TYPE${NC}
  Diretório:         ${CYAN}$INSTALL_DIR${NC}
"
[[ "$INSTALL_TYPE" == "docker" ]] && echo -e "  Logs: ${CYAN}docker compose -f $INSTALL_DIR/docker-compose.yml logs -f app${NC}"
[[ "$INSTALL_TYPE" == "pm2"    ]] && echo -e "  Logs: ${CYAN}pm2 logs vps-drive-api${NC}"
echo ""
