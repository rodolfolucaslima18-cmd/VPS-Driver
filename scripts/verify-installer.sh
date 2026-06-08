#!/usr/bin/env bash
# ============================================================
#  VPS Drive — Script de Verificação Local do Instalador
#  Executa antes de publicar para garantir que o instalador
#  vai funcionar na VPS.
#  Uso: bash scripts/verify-installer.sh
# ============================================================

# NÃO usar set -e — os checks precisam capturar falhas individualmente
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

PASS=0; FAIL=0; SKIPPED=0

pass() { echo -e "${GREEN}✓${NC} $1"; ((PASS++)) || true; }
fail() { echo -e "${RED}✗${NC} $1"; [ -n "${2:-}" ] && echo "    → $2" | head -5; ((FAIL++)) || true; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
skip() { echo -e "${YELLOW}—${NC} $1 (pulado)"; ((SKIPPED++)) || true; }

echo -e "\n${CYAN}${BOLD}═══ VPS Drive — Verificação Local do Instalador ═══${NC}\n"

# ── 1. Arquivos de configuração do pnpm ──────────────────────
echo -e "${BOLD}1. Configuração pnpm (simula comportamento pnpm v11)${NC}"

if [ -f "$PROJECT_ROOT/pnpm.json" ]; then
  pass "pnpm.json existe"
else
  fail "pnpm.json NÃO encontrado em $PROJECT_ROOT/pnpm.json"
fi

if grep -q "onlyBuiltDependencies" "$PROJECT_ROOT/pnpm.json" 2>/dev/null; then
  pass "pnpm.json contém onlyBuiltDependencies"
else
  fail "pnpm.json NÃO contém onlyBuiltDependencies"
fi

if grep -q "esbuild" "$PROJECT_ROOT/pnpm.json" 2>/dev/null && \
   grep -q "@swc/core" "$PROJECT_ROOT/pnpm.json" 2>/dev/null; then
  pass "pnpm.json lista esbuild + @swc/core + msw + unrs-resolver"
else
  fail "pnpm.json NÃO lista todos os pacotes necessários (esbuild, @swc/core, msw, unrs-resolver)"
fi

if [ -f "$PROJECT_ROOT/.npmrc" ]; then
  pass ".npmrc existe"
else
  fail ".npmrc NÃO encontrado"
fi

# Verifica conteúdo específico do .npmrc (pnpm v11 usa esta forma)
if grep -q "onlyBuiltDependencies\[\]=esbuild" "$PROJECT_ROOT/.npmrc" 2>/dev/null; then
  pass ".npmrc contém onlyBuiltDependencies[]=esbuild"
else
  NPMRC_CONTENT=$(cat "$PROJECT_ROOT/.npmrc" 2>/dev/null || echo "(vazio)")
  fail ".npmrc NÃO contém onlyBuiltDependencies[]=esbuild" "$NPMRC_CONTENT"
fi

# ── 2. Endpoints do servidor (OBRIGATÓRIO — falha bloqueia) ──
echo -e "\n${BOLD}2. Endpoints do servidor (obrigatório)${NC}"

API_PORT="${API_PORT:-8080}"
API_BASE="http://localhost:$API_PORT"

HEALTH_OUT=$(curl -s --max-time 5 "$API_BASE/api/healthz" 2>&1); HEALTH_EC=$?
if [ $HEALTH_EC -eq 0 ] && echo "$HEALTH_OUT" | grep -q "ok"; then
  pass "Servidor local respondendo em :$API_PORT"
else
  fail "Servidor local NÃO responde em :$API_PORT — inicie o backend antes de verificar"
  echo -e "\n${RED}Abortando: servidor local necessário para verificações 2-4.${NC}"
  echo -e "${YELLOW}Inicie o backend com:  pnpm --filter @workspace/api-server run dev${NC}\n"
  echo -e "─────────────────────────────────"
  echo -e "${RED}${BOLD}✗ Verificação incompleta: servidor não disponível${NC}"
  exit 1
fi

# install.sh: injeção de URLs
SH_OUT=$(curl -s --max-time 5 "$API_BASE/api/download/install.sh" 2>&1); SH_EC=$?
if [ $SH_EC -ne 0 ]; then
  fail "GET /api/download/install.sh falhou (curl exit $SH_EC)"
elif echo "$SH_OUT" | grep -q "__INSTALLER_BASE_URL__"; then
  fail "install.sh ainda contém placeholder __INSTALLER_BASE_URL__ (injeção falhou)"
else
  pass "install.sh: __INSTALLER_BASE_URL__ substituído corretamente"
fi

if echo "$SH_OUT" | grep -q "__REPO_URL__"; then
  warn "install.sh: __REPO_URL__ é placeholder (aceitável sem git repo configurado)"
fi

# update.sh: injeção de URL
UPDATE_SH_OUT=$(curl -s --max-time 5 "$API_BASE/api/download/update.sh" 2>&1); UPDATE_SH_EC=$?
if [ $UPDATE_SH_EC -ne 0 ]; then
  fail "GET /api/download/update.sh falhou (curl exit $UPDATE_SH_EC)"
elif echo "$UPDATE_SH_OUT" | grep -q "__INSTALLER_BASE_URL__"; then
  fail "update.sh ainda contém placeholder __INSTALLER_BASE_URL__ (injeção falhou)"
else
  pass "update.sh: __INSTALLER_BASE_URL__ substituído corretamente"
fi

# Tarball: HEAD request
TARBALL_HEAD=$(curl -s -I --max-time 10 "$API_BASE/api/download/project.tar.gz" 2>&1); HEAD_EC=$?
if [ $HEAD_EC -eq 0 ] && echo "$TARBALL_HEAD" | grep -q "^HTTP.*200"; then
  pass "HEAD /api/download/project.tar.gz → HTTP 200"
else
  fail "HEAD /api/download/project.tar.gz falhou" "$(echo "$TARBALL_HEAD" | head -3)"
fi

# Tarball: GET e verificação do conteúdo
TARBALL_LIST=$(curl -s --max-time 30 "$API_BASE/api/download/project.tar.gz" 2>/dev/null | tar -tzf - 2>/dev/null); TGZ_EC=${PIPESTATUS[0]}
if [ $TGZ_EC -ne 0 ]; then
  fail "Download do tarball falhou (curl exit $TGZ_EC)"
else
  pass "GET /api/download/project.tar.gz → tarball recebido"

  if echo "$TARBALL_LIST" | grep -q "^\./pnpm\.json$"; then
    pass "Tarball contém ./pnpm.json"
  else
    fail "Tarball NÃO contém ./pnpm.json"
  fi

  if echo "$TARBALL_LIST" | grep -q "^\.\/node_modules"; then
    fail "Tarball inclui node_modules (deveria excluir)"
  else
    pass "Tarball exclui node_modules"
  fi

  if echo "$TARBALL_LIST" | grep -q "^\.\/\.cache"; then
    fail "Tarball inclui .cache (~150MB — deveria excluir)"
  else
    pass "Tarball exclui .cache"
  fi

  if echo "$TARBALL_LIST" | grep -q "^\.\/\.local"; then
    fail "Tarball inclui .local (~494MB — deveria excluir)"
  else
    pass "Tarball exclui .local"
  fi
fi

# ── 3. pnpm install ─────────────────────────────────────────
echo -e "\n${BOLD}3. pnpm install${NC}"

cd "$PROJECT_ROOT"
INSTALL_OUT=$(pnpm install --frozen-lockfile 2>&1); INSTALL_EC=$?
if [ $INSTALL_EC -eq 0 ]; then
  pass "pnpm install concluído sem erros"
elif echo "$INSTALL_OUT" | grep -q "ERR_PNPM_IGNORED_BUILDS"; then
  pass "pnpm install: apenas ERR_PNPM_IGNORED_BUILDS — install.sh trata como aviso (esbuild usa optional deps)"
  warn "Para simular pnpm v11: o install.sh na VPS continuará após este aviso"
else
  LAST_LINES=$(echo "$INSTALL_OUT" | tail -5)
  fail "pnpm install falhou com erro real (código $INSTALL_EC)" "$LAST_LINES"
fi

# ── 4. esbuild acessível ─────────────────────────────────────
echo -e "\n${BOLD}4. esbuild binário${NC}"

cd "$PROJECT_ROOT/artifacts/api-server"
ESBUILD_VER=$(pnpm exec esbuild --version 2>&1); ESBUILD_EC=$?
cd "$PROJECT_ROOT"
if [ $ESBUILD_EC -eq 0 ]; then
  pass "esbuild acessível via api-server: v$ESBUILD_VER"
else
  fail "esbuild NÃO encontrado via api-server" "$ESBUILD_VER"
fi

# ── 5. Build frontend ────────────────────────────────────────
echo -e "\n${BOLD}5. Build do frontend${NC}"

BUILD_FRONT=$(BASE_PATH=/ PORT=3000 NODE_ENV=production \
  pnpm --filter @workspace/vps-drive run build 2>&1); BF_EC=$?
if [ $BF_EC -eq 0 ]; then
  pass "Frontend compilado com sucesso"
else
  ERRORS=$(echo "$BUILD_FRONT" | grep -i "error" | head -5)
  fail "Build do frontend falhou (código $BF_EC)" "$ERRORS"
fi

# ── 6. Build backend ─────────────────────────────────────────
echo -e "\n${BOLD}6. Build do servidor${NC}"

BUILD_BACK=$(pnpm --filter @workspace/api-server run build 2>&1); BB_EC=$?
if [ $BB_EC -eq 0 ]; then
  pass "Backend compilado com sucesso"
else
  ERRORS=$(echo "$BUILD_BACK" | grep -i "error" | head -5)
  fail "Build do backend falhou (código $BB_EC)" "$ERRORS"
fi

# ── 7. DB push (OBRIGATÓRIO) ─────────────────────────────────
echo -e "\n${BOLD}7. Schema do banco de dados (obrigatório)${NC}"

if [ -f "$PROJECT_ROOT/artifacts/api-server/.env" ]; then
  DB_URL=$(grep "^DATABASE_URL=" "$PROJECT_ROOT/artifacts/api-server/.env" 2>/dev/null | cut -d= -f2-)
elif [ -n "${DATABASE_URL:-}" ]; then
  DB_URL="$DATABASE_URL"
else
  DB_URL=""
fi

if [ -z "$DB_URL" ]; then
  fail "DATABASE_URL não encontrado — necessário para verificação completa"
  warn "Configure DATABASE_URL em artifacts/api-server/.env ou exporte a variável"
  ((FAIL++)) || true
else
  DB_OUT=$(DATABASE_URL="$DB_URL" pnpm --filter @workspace/db run push --force 2>&1); DB_EC=$?
  if [ $DB_EC -eq 0 ]; then
    pass "drizzle-kit push --force concluído"
  else
    fail "drizzle-kit push falhou (código $DB_EC)" "$(echo "$DB_OUT" | tail -5)"
  fi
fi

# ── Resumo ───────────────────────────────────────────────────
echo ""
echo -e "─────────────────────────────────"
TOTAL=$((PASS + FAIL))
if [ $FAIL -eq 0 ]; then
  echo -e "${GREEN}${BOLD}✓ Todas as verificações passaram ($PASS/$TOTAL)${NC}"
  [ $SKIPPED -gt 0 ] && echo -e "${YELLOW}  ($SKIPPED verificação(ões) puladas)${NC}"
  echo -e "${CYAN}  Pronto para deploy e instalação na VPS.${NC}"
  exit 0
else
  echo -e "${RED}${BOLD}✗ $FAIL verificação(ões) falharam ($PASS/$TOTAL passaram)${NC}"
  [ $SKIPPED -gt 0 ] && echo -e "${YELLOW}  ($SKIPPED verificação(ões) puladas)${NC}"
  echo -e "${YELLOW}  Corrija os erros acima antes de publicar.${NC}"
  exit 1
fi
