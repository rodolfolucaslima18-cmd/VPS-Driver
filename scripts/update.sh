#!/usr/bin/env bash
# ============================================================
#  VPS Drive — Script de Atualização
#  Atualiza código, dependências e rebuild sem reinstalar.
#
#  Uso:
#    sudo VPS_DRIVE_REPO_URL=https://github.com/rodolfolucaslima18-cmd/VPS-Driver.git \
#      bash scripts/update.sh
#    O painel admin define a mesma URL automaticamente.
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

# O repositório pode ser configurado pelo painel admin ou informado ao executar
# o script. O fallback mantém o instalador funcional para instalações novas.
DEFAULT_GIT_REPO="https://github.com/rodolfolucaslima18-cmd/VPS-Driver.git"
REPO_PLACEHOLDER="__REPO""_URL__"
BRANCH_PLACEHOLDER="__REPO""_BRANCH__"
GIT_REPO="${VPS_DRIVE_REPO_URL:-__REPO_URL__}"
GIT_BRANCH="${VPS_DRIVE_REPO_BRANCH:-__REPO_BRANCH__}"

if [[ -z "$GIT_REPO" || "$GIT_REPO" == "$REPO_PLACEHOLDER" ]]; then
  GIT_REPO="$DEFAULT_GIT_REPO"
fi
if [[ -z "$GIT_BRANCH" || "$GIT_BRANCH" == "$BRANCH_PLACEHOLDER" ]]; then
  GIT_BRANCH="main"
fi

GIT_REPO="${GIT_REPO%/}"

echo -e "
${BOLD}${CYAN}╔══════════════════════════════════════╗
║       VPS Drive — Atualização        ║
╚══════════════════════════════════════╝${NC}
"

# ── Verificar root ───────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
  error "Execute como root: sudo bash update.sh"
fi

# ── Localizar instalação ─────────────────────────────────────
step "Localizando instalação do VPS Drive..."

INSTALL_DIR="${VPS_DRIVE_DIR:-/opt/vps-drive}"
if [[ ! -f "$INSTALL_DIR/package.json" ]]; then
  error "VPS Drive não encontrado em $INSTALL_DIR. Verifique a variável VPS_DRIVE_DIR ou instale primeiro."
fi
ok "Instalação encontrada em $INSTALL_DIR"

# ── Carregar configuração atual ──────────────────────────────
ENV_FILE="$INSTALL_DIR/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  error "Arquivo .env não encontrado em $ENV_FILE. A instalação parece incompleta."
fi

# Ler as variáveis necessárias sem executar o conteúdo do .env.
APP_PORT=$(grep "^PORT=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- || echo "5000")
APP_PORT="${APP_PORT:-5000}"
STORAGE_PATH=$(grep "^STORAGE_PATH=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- || echo "/data/vps-drive")
STORAGE_PATH="${STORAGE_PATH:-/data/vps-drive}"

ok "Configuração carregada (porta: $APP_PORT)"

# ── Buscar código novo no GitHub ──────────────────────────────
step "Buscando código atualizado no GitHub..."

if ! command -v git &>/dev/null; then
  error "Git não está instalado. Instale com: apt-get install -y git"
fi

if ! [[ "$GIT_REPO" =~ ^https://github\.com/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+(\.git)?$ ||
        "$GIT_REPO" =~ ^git@github\.com:[A-Za-z0-9._-]+/[A-Za-z0-9._-]+(\.git)?$ ]]; then
  error "Repositório inválido: $GIT_REPO
  Informe a URL do repositório GitHub, por exemplo:
  https://github.com/rodolfolucaslima18-cmd/VPS-Driver.git"
fi

if ! [[ "$GIT_BRANCH" =~ ^[A-Za-z0-9._/-]+$ ]] ||
   [[ "$GIT_BRANCH" == -* || "$GIT_BRANCH" == *".."* || "$GIT_BRANCH" == *"//"* ]]; then
  error "Branch inválida: $GIT_BRANCH"
fi

TMPDIR_UPDATE=$(mktemp -d)
trap 'rm -rf "$TMPDIR_UPDATE"' EXIT

# Backup da configuração atual antes de atualizar os arquivos rastreados pelo Git.
cp "$ENV_FILE" "$TMPDIR_UPDATE/.env.bak"

# O caminho padrão fica fora da instalação, mas instalações antigas podem guardar
# arquivos em um diretório relativo. Faça backup explícito antes de um reset Git ou
# rsync --delete para preservar inclusive arquivos com o mesmo nome do repositório.
INSTALL_DIR_ABS=$(realpath -m "$INSTALL_DIR")
if [[ "$STORAGE_PATH" = /* ]]; then
  STORAGE_DIR=$(realpath -m "$STORAGE_PATH")
else
  STORAGE_DIR=$(realpath -m "$INSTALL_DIR_ABS/$STORAGE_PATH")
fi

STORAGE_BACKUP_DIR="$TMPDIR_UPDATE/storage.bak"
STORAGE_BACKUP_READY=false
if [[ "$STORAGE_DIR" == "$INSTALL_DIR_ABS" ]]; then
  error "STORAGE_PATH não pode ser o próprio diretório da instalação: $STORAGE_PATH"
fi
if [[ "$STORAGE_DIR" == "$INSTALL_DIR_ABS/"* && -d "$STORAGE_DIR" ]]; then
  mkdir -p "$STORAGE_BACKUP_DIR"
  cp -a "$STORAGE_DIR/." "$STORAGE_BACKUP_DIR/"
  STORAGE_BACKUP_READY=true
  ok "Backup dos arquivos enviados criado"
fi

if [[ -d "$INSTALL_DIR/.git" ]]; then
  echo "  Atualizando repositório existente: $GIT_REPO ($GIT_BRANCH)"
  if git -C "$INSTALL_DIR" remote get-url origin >/dev/null 2>&1; then
    git -C "$INSTALL_DIR" remote set-url origin "$GIT_REPO"
  else
    git -C "$INSTALL_DIR" remote add origin "$GIT_REPO"
  fi
  git -C "$INSTALL_DIR" fetch --depth 1 origin "$GIT_BRANCH"
  git -C "$INSTALL_DIR" checkout --force -B "$GIT_BRANCH" FETCH_HEAD
  git -C "$INSTALL_DIR" reset --hard FETCH_HEAD
else
  echo "  A instalação não tinha repositório Git; preparando cópia atualizada..."
  SOURCE_DIR="$TMPDIR_UPDATE/repository"
  git clone --depth 1 --branch "$GIT_BRANCH" "$GIT_REPO" "$SOURCE_DIR"
  rsync -a --delete \
    --exclude='.env' \
    --exclude='node_modules' \
    --exclude='storage' \
    --exclude='artifacts/api-server/dist' \
    --exclude='artifacts/vps-drive/dist' \
    --exclude='artifacts/mockup-sandbox/dist' \
    "$SOURCE_DIR/" "$INSTALL_DIR/"
fi

# O .env nunca deve ser alterado pela atualização, inclusive em instalações antigas
# onde ele tenha sido incluído no histórico do Git por engano.
if [[ ! -f "$ENV_FILE" ]] || ! cmp -s "$ENV_FILE" "$TMPDIR_UPDATE/.env.bak"; then
  cp "$TMPDIR_UPDATE/.env.bak" "$ENV_FILE"
  warn ".env restaurado do backup para preservar a configuração"
fi

if [[ "$STORAGE_BACKUP_READY" == true ]]; then
  mkdir -p "$STORAGE_DIR"
  cp -a "$STORAGE_BACKUP_DIR/." "$STORAGE_DIR/"
  ok "Arquivos enviados restaurados"
fi

ok "Código da branch $GIT_BRANCH aplicado"

cd "$INSTALL_DIR"

# ── Verificar/corrigir pnpm ───────────────────────────────────
step "Verificando pnpm..."
if command -v pnpm &>/dev/null; then
  PNPM_MAJOR=$(pnpm --version 2>/dev/null | cut -d. -f1)
  if [ "${PNPM_MAJOR:-0}" -ge 11 ]; then
    echo "  pnpm v$(pnpm --version) detectado — fazendo downgrade para v10..."
    npm install -g pnpm@10 --quiet 2>&1 | tail -2
    hash -r
    ok "pnpm $(pnpm --version) (v10)"
  else
    ok "pnpm $(pnpm --version)"
  fi
else
  npm install -g pnpm@10 --quiet
  ok "pnpm $(pnpm --version) instalado"
fi

# ── Instalar dependências ────────────────────────────────────
step "Instalando dependências..."

# Garantir pnpm.json e .npmrc atualizados
printf '{"onlyBuiltDependencies":["@swc/core","esbuild","msw","unrs-resolver"]}\n' > pnpm.json
grep -q "minimum-release-age" .npmrc 2>/dev/null \
  || echo "minimum-release-age=0" >> .npmrc
grep -q "onlyBuiltDependencies" .npmrc 2>/dev/null \
  || { echo "onlyBuiltDependencies[]=@swc/core" >> .npmrc
       echo "onlyBuiltDependencies[]=esbuild" >> .npmrc
       echo "onlyBuiltDependencies[]=msw" >> .npmrc
       echo "onlyBuiltDependencies[]=unrs-resolver" >> .npmrc; }

set +e
_pnpm_out=$(pnpm install --frozen-lockfile 2>&1); _pnpm_ec=$?
if [ $_pnpm_ec -ne 0 ]; then
  _pnpm_out=$(pnpm install 2>&1); _pnpm_ec=$?
fi
set -e

echo "$_pnpm_out" \
  | grep -v "ERR_PNPM_IGNORED_BUILDS\|Run \"pnpm approve-builds\"" \
  | tail -4 || true

if [ $_pnpm_ec -ne 0 ] && ! echo "$_pnpm_out" | grep -q "ERR_PNPM_IGNORED_BUILDS"; then
  error "pnpm install falhou (código $_pnpm_ec)."
fi
ok "Dependências instaladas"

# Alterações de schema não são aplicadas automaticamente. O comando anterior
# usava drizzle-kit push --force, que pode aceitar mudanças destrutivas e causar
# perda de dados. Atualizações de banco devem ser feitas com migrações revisadas.
ok "Banco de dados preservado (nenhuma alteração automática de schema)"

# ── Carregar variáveis do .env para build ────────────────────
# Necessário para que VITE_* sejam embutidas no bundle do frontend
set -a
# shellcheck source=/dev/null
source "$ENV_FILE" 2>/dev/null || true
set +a

# ── Build frontend ────────────────────────────────────────────
step "Compilando frontend..."
set +e
_fe_out=$(BASE_PATH=/ PORT=3000 NODE_ENV=production \
  pnpm --filter @workspace/vps-drive run build 2>&1); _fe_ec=$?
set -e
echo "$_fe_out" | tail -6
if [ $_fe_ec -ne 0 ]; then
  error "Build do frontend falhou (código $_fe_ec)."
fi
ok "Frontend compilado"

# ── Build backend ─────────────────────────────────────────────
step "Compilando servidor..."
set +e
_be_out=$(pnpm --filter @workspace/api-server run build 2>&1); _be_ec=$?
set -e
echo "$_be_out" | tail -4
if [ $_be_ec -ne 0 ]; then
  error "Build do servidor falhou (código $_be_ec)."
fi
ok "Servidor compilado"

# ── Corrigir cache do Nginx para index.html (one-time patch) ─────────────────
NGINX_CONF="/etc/nginx/sites-available/vps-drive"
if [[ -f "$NGINX_CONF" ]] && ! grep -q "no-store" "$NGINX_CONF"; then
  step "Nginx: adicionando Cache-Control para index.html..."
  TMP_PY=$(mktemp)
  cat > "$TMP_PY" << 'PYEOF'
import sys
conf_path = sys.argv[1]
install_dir = sys.argv[2]
with open(conf_path) as f:
    conf = f.read()
block = (
    '    location = /index.html {\n'
    '        root ' + install_dir + '/artifacts/vps-drive/dist/public;\n'
    '        add_header Cache-Control "no-store, no-cache, must-revalidate";\n'
    '        add_header Pragma "no-cache";\n'
    '        expires 0;\n'
    '    }\n\n'
)
conf = conf.replace('    location / {', block + '    location / {', 1)
with open(conf_path, 'w') as f:
    f.write(conf)
PYEOF
  python3 "$TMP_PY" "$NGINX_CONF" "$INSTALL_DIR"
  rm -f "$TMP_PY"
  if nginx -t 2>&1; then
    systemctl reload nginx
    ok "Nginx atualizado: Cache-Control aplicado"
  else
    warn "Config Nginx inválida após patch — revertendo"
    git -C / checkout -- "$NGINX_CONF" 2>/dev/null || true
  fi
fi

# ── Reiniciar PM2 ────────────────────────────────────────────
step "Reiniciando servidor (PM2)..."
set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a

if pm2 describe vps-drive-api &>/dev/null; then
  pm2 reload vps-drive-api --update-env
  ok "vps-drive-api recarregado (graceful reload)"
else
  pm2 start "$INSTALL_DIR/artifacts/api-server/dist/index.mjs" \
    --name "vps-drive-api" \
    --cwd "$INSTALL_DIR"
  pm2 save
  ok "vps-drive-api iniciado"
fi

# ── Verificar saúde ───────────────────────────────────────────
step "Verificando servidor..."
echo "  Aguardando reinicialização..."
sleep 4
for i in $(seq 1 10); do
  HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$APP_PORT/api/healthz" 2>/dev/null || echo "000")
  if [[ "$HTTP_STATUS" == "200" ]]; then
    ok "Servidor respondendo: http://localhost:$APP_PORT/api/healthz → HTTP 200"
    break
  fi
  if [[ $i -eq 10 ]]; then
    pm2 logs vps-drive-api --lines 15 --nostream 2>/dev/null || true
    error "Servidor não respondeu após reinicialização. Veja os logs acima."
  fi
  echo "  Tentativa $i/10: HTTP $HTTP_STATUS..."
  sleep 3
done

echo -e "
${BOLD}${GREEN}╔══════════════════════════════════════════════╗
║     ✅  Atualização concluída com sucesso!    ║
╚══════════════════════════════════════════════╝${NC}
"
echo -e "  O VPS Drive foi atualizado e está rodando normalmente."
echo -e "  Para verificar logs: ${CYAN}pm2 logs vps-drive-api${NC}"
echo ""
