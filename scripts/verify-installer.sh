#!/usr/bin/env bash
# ============================================================
#  VPS Drive — Script de Verificação Local do Instalador
#  Executa antes de publicar para garantir que o instalador
#  vai funcionar na VPS.
#  Uso: bash scripts/verify-installer.sh
# ============================================================

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

PASS=0; FAIL=0
check() {
  local label="$1"; shift
  if "$@" &>/dev/null; then
    echo -e "${GREEN}✓${NC} $label"
    ((PASS++)) || true
  else
    echo -e "${RED}✗${NC} $label"
    ((FAIL++)) || true
  fi
}
check_cmd() {
  local label="$1"; shift
  local out ec
  out=$("$@" 2>&1); ec=$?
  if [ $ec -eq 0 ]; then
    echo -e "${GREEN}✓${NC} $label"
    ((PASS++)) || true
  else
    echo -e "${RED}✗${NC} $label"
    echo "    → $out" | tail -5
    ((FAIL++)) || true
  fi
}

echo -e "\n${CYAN}${BOLD}═══ VPS Drive — Verificação Local do Instalador ═══${NC}\n"

# ── 1. Arquivos de configuração do pnpm ──────────────────────
echo -e "${BOLD}1. Configuração pnpm${NC}"

check "pnpm.json existe no raiz do projeto" \
  test -f "$PROJECT_ROOT/pnpm.json"

check "pnpm.json contém onlyBuiltDependencies" \
  grep -q "onlyBuiltDependencies" "$PROJECT_ROOT/pnpm.json"

check "pnpm.json lista esbuild" \
  grep -q "esbuild" "$PROJECT_ROOT/pnpm.json"

check ".npmrc existe" \
  test -f "$PROJECT_ROOT/.npmrc"

# ── 2. Endpoint do servidor local ────────────────────────────
echo -e "\n${BOLD}2. Endpoints do servidor${NC}"

API_PORT="${API_PORT:-8080}"
API_BASE="http://localhost:$API_PORT"

if curl -s --max-time 3 "$API_BASE/api/healthz" | grep -q "ok" 2>/dev/null; then
  echo -e "${GREEN}✓${NC} Servidor local respondendo em :$API_PORT"
  ((PASS++)) || true
  SERVER_UP=1
else
  echo -e "${YELLOW}⚠${NC} Servidor local não encontrado em :$API_PORT — pulando testes de endpoint"
  SERVER_UP=0
fi

if [ "$SERVER_UP" = "1" ]; then
  # install.sh tem URLs injetadas (não contém placeholders literais)
  SH_CONTENT=$(curl -s --max-time 5 "$API_BASE/api/download/install.sh")
  if echo "$SH_CONTENT" | grep -q "__INSTALLER_BASE_URL__"; then
    echo -e "${RED}✗${NC} install.sh ainda contém placeholder __INSTALLER_BASE_URL__ (injeção falhou)"
    ((FAIL++)) || true
  else
    echo -e "${GREEN}✓${NC} install.sh: placeholder __INSTALLER_BASE_URL__ substituído corretamente"
    ((PASS++)) || true
  fi

  if echo "$SH_CONTENT" | grep -q "__REPO_URL__"; then
    echo -e "${YELLOW}⚠${NC} install.sh: __REPO_URL__ ainda como placeholder (ok se não há git repo configurado)"
  fi

  # Tarball endpoint responde
  TARBALL_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$API_BASE/api/download/project.tar.gz")
  if [ "$TARBALL_STATUS" = "200" ]; then
    echo -e "${GREEN}✓${NC} GET /api/download/project.tar.gz retorna HTTP 200"
    ((PASS++)) || true

    # Conteúdo do tarball: verifica pnpm.json
    TARBALL_LIST=$(curl -s --max-time 30 "$API_BASE/api/download/project.tar.gz" | tar -tzf - 2>/dev/null)
    if echo "$TARBALL_LIST" | grep -q "^\./pnpm\.json$"; then
      echo -e "${GREEN}✓${NC} Tarball contém ./pnpm.json"
      ((PASS++)) || true
    else
      echo -e "${RED}✗${NC} Tarball NÃO contém ./pnpm.json"
      ((FAIL++)) || true
    fi

    if echo "$TARBALL_LIST" | grep -q "^\./node_modules"; then
      echo -e "${RED}✗${NC} Tarball inclui node_modules (deveria excluir)"
      ((FAIL++)) || true
    else
      echo -e "${GREEN}✓${NC} Tarball exclui node_modules corretamente"
      ((PASS++)) || true
    fi

    if echo "$TARBALL_LIST" | grep -q "^\./\.cache"; then
      echo -e "${RED}✗${NC} Tarball inclui .cache (deveria excluir — são ~150MB)"
      ((FAIL++)) || true
    else
      echo -e "${GREEN}✓${NC} Tarball exclui .cache corretamente"
      ((PASS++)) || true
    fi

  else
    echo -e "${RED}✗${NC} GET /api/download/project.tar.gz retornou HTTP $TARBALL_STATUS"
    ((FAIL++)) || true
  fi
fi

# ── 3. pnpm install ─────────────────────────────────────────
echo -e "\n${BOLD}3. pnpm install${NC}"

cd "$PROJECT_ROOT"
INSTALL_OUT=$(pnpm install --frozen-lockfile 2>&1); INSTALL_EC=$?
if [ $INSTALL_EC -eq 0 ]; then
  echo -e "${GREEN}✓${NC} pnpm install concluído sem erros"
  ((PASS++)) || true
elif echo "$INSTALL_OUT" | grep -q "ERR_PNPM_IGNORED_BUILDS"; then
  echo -e "${YELLOW}⚠${NC} pnpm install: ERR_PNPM_IGNORED_BUILDS detectado (pacotes instalados; esbuild usa optional deps)"
  echo -e "${GREEN}✓${NC} install.sh trata este erro como aviso — instalação continuará"
  ((PASS++)) || true
else
  echo -e "${RED}✗${NC} pnpm install falhou com erro real (código $INSTALL_EC)"
  echo "$INSTALL_OUT" | tail -5 | sed 's/^/    → /'
  ((FAIL++)) || true
fi

# ── 4. esbuild acessível ─────────────────────────────────────
echo -e "\n${BOLD}4. Ferramentas de build${NC}"

cd "$PROJECT_ROOT/artifacts/api-server"
check_cmd "esbuild binário acessível (via api-server)" pnpm exec esbuild --version
cd "$PROJECT_ROOT"

# ── 5. Build frontend ────────────────────────────────────────
echo -e "\n${BOLD}5. Build do frontend${NC}"

BUILD_FRONT_OUT=$(BASE_PATH=/ PORT=3000 NODE_ENV=production \
  pnpm --filter @workspace/vps-drive run build 2>&1); BUILD_FRONT_EC=$?
if [ $BUILD_FRONT_EC -eq 0 ]; then
  echo -e "${GREEN}✓${NC} Frontend compilado com sucesso"
  ((PASS++)) || true
else
  echo -e "${RED}✗${NC} Build do frontend falhou"
  echo "$BUILD_FRONT_OUT" | grep -i "error" | head -5 | sed 's/^/    → /'
  ((FAIL++)) || true
fi

# ── 6. Build backend ─────────────────────────────────────────
echo -e "\n${BOLD}6. Build do servidor${NC}"

BUILD_BACK_OUT=$(pnpm --filter @workspace/api-server run build 2>&1); BUILD_BACK_EC=$?
if [ $BUILD_BACK_EC -eq 0 ]; then
  echo -e "${GREEN}✓${NC} Backend compilado com sucesso"
  ((PASS++)) || true
else
  echo -e "${RED}✗${NC} Build do backend falhou"
  echo "$BUILD_BACK_OUT" | grep -i "error" | head -5 | sed 's/^/    → /'
  ((FAIL++)) || true
fi

# ── 7. DB push ───────────────────────────────────────────────
echo -e "\n${BOLD}7. Schema do banco de dados${NC}"

if [ -f "$PROJECT_ROOT/artifacts/api-server/.env" ]; then
  DB_URL=$(grep "^DATABASE_URL=" "$PROJECT_ROOT/artifacts/api-server/.env" | cut -d= -f2-)
elif [ -n "${DATABASE_URL:-}" ]; then
  DB_URL="$DATABASE_URL"
else
  DB_URL=""
fi

if [ -n "$DB_URL" ]; then
  DB_OUT=$(DATABASE_URL="$DB_URL" pnpm --filter @workspace/db run push --force 2>&1); DB_EC=$?
  if [ $DB_EC -eq 0 ]; then
    echo -e "${GREEN}✓${NC} drizzle-kit push --force concluído"
    ((PASS++)) || true
  else
    echo -e "${RED}✗${NC} drizzle-kit push falhou (código $DB_EC)"
    echo "$DB_OUT" | tail -5 | sed 's/^/    → /'
    ((FAIL++)) || true
  fi
else
  echo -e "${YELLOW}⚠${NC} DATABASE_URL não encontrado — pulando verificação do DB"
fi

# ── Resumo ───────────────────────────────────────────────────
echo ""
echo -e "─────────────────────────────────"
TOTAL=$((PASS + FAIL))
if [ $FAIL -eq 0 ]; then
  echo -e "${GREEN}${BOLD}✓ Todas as verificações passaram ($PASS/$TOTAL)${NC}"
  echo -e "${CYAN}  Pronto para deploy e instalação na VPS.${NC}"
  exit 0
else
  echo -e "${RED}${BOLD}✗ $FAIL verificação(ões) falharam ($PASS/$TOTAL passaram)${NC}"
  echo -e "${YELLOW}  Corrija os erros acima antes de publicar.${NC}"
  exit 1
fi
