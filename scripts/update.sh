#!/usr/bin/env bash
# ============================================================
#  VPS Drive — Script de Atualização
#  Atualiza código, dependências e rebuild sem reinstalar.
#
#  Uso:
#    bash <(curl -sL https://HOST/api/download/update.sh)
#    bash scripts/update.sh   (de dentro do projeto)
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

INSTALLER_BASE_URL="__INSTALLER_BASE_URL__"

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

# Ler variáveis necessárias do .env
APP_PORT=$(grep "^PORT=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- || echo "5000")
APP_PORT="${APP_PORT:-5000}"
DATABASE_URL=$(grep "^DATABASE_URL=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- || echo "")

ok "Configuração carregada (porta: $APP_PORT)"

# Garantir ONLYOFFICE_URL e VITE_ONLYOFFICE_URL no .env (sem sobrescrever se já existem)
if ! grep -q "^ONLYOFFICE_URL=" "$ENV_FILE" 2>/dev/null; then
  echo "ONLYOFFICE_URL=" >> "$ENV_FILE"
  warn "ONLYOFFICE_URL adicionado ao .env (vazio). Edite o .env para configurar o OnlyOffice."
fi
if ! grep -q "^VITE_ONLYOFFICE_URL=" "$ENV_FILE" 2>/dev/null; then
  echo "VITE_ONLYOFFICE_URL=" >> "$ENV_FILE"
fi

# ── Baixar e extrair código novo ─────────────────────────────
step "Baixando código atualizado..."

if [[ -z "$INSTALLER_BASE_URL" || "$INSTALLER_BASE_URL" == "__INSTALLER_BASE_URL__" ]]; then
  error "URL base não injetada. Use: bash <(curl -sL https://SEU_HOST/api/download/update.sh)"
fi

TMPDIR_UPDATE=$(mktemp -d)
trap 'rm -rf "$TMPDIR_UPDATE"' EXIT

echo "  Baixando de $INSTALLER_BASE_URL..."
curl -sL --max-time 120 "$INSTALLER_BASE_URL/api/download/project.tar.gz" \
  | tar -xzf - -C "$TMPDIR_UPDATE" 2>/dev/null
ok "Código baixado e extraído"

# ── Copiar arquivos preservando .env e dados ─────────────────
step "Aplicando atualização (preservando .env e /data)..."

# Backup do .env atual
cp "$ENV_FILE" "$TMPDIR_UPDATE/.env.bak"

# Sincronizar código novo para INSTALL_DIR, excluindo arquivos que não devem ser sobrescritos
rsync -a --delete \
  --exclude='.env' \
  --exclude='node_modules' \
  --exclude='artifacts/api-server/dist' \
  --exclude='artifacts/vps-drive/dist' \
  --exclude='artifacts/mockup-sandbox/dist' \
  "$TMPDIR_UPDATE/" "$INSTALL_DIR/"

# Garantir que o .env não foi sobrescrito
if [[ ! -f "$ENV_FILE" ]]; then
  cp "$TMPDIR_UPDATE/.env.bak" "$ENV_FILE"
  warn ".env restaurado do backup"
fi

ok "Código atualizado"

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

# ── Aplicar migrações de schema (opcional) ───────────────────
if [[ -n "$DATABASE_URL" ]]; then
  step "Aplicando schema do banco de dados..."
  set +e
  _db_out=$(DATABASE_URL="$DATABASE_URL" pnpm --filter @workspace/db run push-force 2>&1); _db_ec=$?
  set -e
  echo "$_db_out" | tail -5
  if [ $_db_ec -ne 0 ]; then
    warn "drizzle-kit push falhou (código $_db_ec) — continuando mesmo assim."
  else
    ok "Schema aplicado"
  fi
fi

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
  pm2 restart vps-drive-api --update-env
  ok "vps-drive-api reiniciado"
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
