#!/usr/bin/env bash
# ============================================================
#  VPS Drive — Instalador do OnlyOffice Document Server
#  Instala o OnlyOffice e configura auto-start via systemd.
#  Requer uma instalação existente do VPS Drive.
#
#  Uso:
#    sudo bash scripts/install-onlyoffice.sh
#    sudo bash <(curl -sL https://HOST/api/download/install-onlyoffice.sh)
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

echo -e "
${BOLD}${CYAN}╔══════════════════════════════════════════════╗
║    VPS Drive — OnlyOffice Document Server    ║
╚══════════════════════════════════════════════╝${NC}
"
echo -e "Este script instala o OnlyOffice e configura auto-start na VPS."
echo -e "Requisitos: VPS Drive instalado, Ubuntu 20.04+ ou Debian 11+\n"

# ── Verificar root ───────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
  error "Execute como root: sudo bash install-onlyoffice.sh"
fi

# ── Localizar instalação do VPS Drive ────────────────────────
step "Localizando instalação do VPS Drive..."
INSTALL_DIR="${VPS_DRIVE_DIR:-/opt/vps-drive}"
if [[ ! -f "$INSTALL_DIR/package.json" ]]; then
  error "VPS Drive não encontrado em $INSTALL_DIR. Instale o VPS Drive primeiro ou defina VPS_DRIVE_DIR."
fi
ok "Instalação encontrada em $INSTALL_DIR"

# ── Ler configuração do .env ─────────────────────────────────
ENV_FILE="$INSTALL_DIR/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  error "Arquivo .env não encontrado em $ENV_FILE. A instalação parece incompleta."
fi

VPS_HOST=$(grep "^VPS_HOST=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- || echo "")
APP_PORT=$(grep "^PORT=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- || echo "5000")
APP_PORT="${APP_PORT:-5000}"
DATABASE_URL=$(grep "^DATABASE_URL=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- || echo "")

[[ -z "$VPS_HOST" ]] && error "VPS_HOST não encontrado no .env. Verifique a instalação."
ok "VPS_HOST=$VPS_HOST, porta interna=$APP_PORT"

# ── Verificar se OnlyOffice já está rodando ───────────────────
if docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^onlyoffice$'; then
  echo ""
  warn "O container 'onlyoffice' já está rodando."
  read -rp "Deseja reinstalar/reconfigurar o auto-start? [s/N]: " REINSTALL
  if [[ "${REINSTALL,,}" != "s" ]]; then
    echo "Operação cancelada."
    exit 0
  fi
fi

echo ""
echo -e "Porta do OnlyOffice: 8080 (padrão Docker, fixo)"
echo ""
read -rp "Confirmar instalação do OnlyOffice em $VPS_HOST:8080? [s/N]: " CONFIRM
[[ "${CONFIRM,,}" != "s" ]] && { echo "Instalação cancelada."; exit 0; }

ONLYOFFICE_URL="http://$VPS_HOST:8080"

# ── Instalar Docker ───────────────────────────────────────────
step "Verificando Docker..."
if command -v docker &>/dev/null; then
  ok "Docker já está instalado ($(docker --version))"
else
  echo "  Instalando Docker via get.docker.com..."
  curl -fsSL https://get.docker.com | sh
  ok "Docker instalado"
fi

# Garantir que o Docker inicia no boot
systemctl enable docker 2>/dev/null || true
systemctl start docker 2>/dev/null || true
ok "Docker habilitado no startup"

# ── Criar/iniciar container OnlyOffice ───────────────────────
step "Configurando container OnlyOffice..."
if docker ps -a --format '{{.Names}}' | grep -q '^onlyoffice$'; then
  echo "  Container 'onlyoffice' já existe."
  docker start onlyoffice 2>/dev/null || true
  ok "Container onlyoffice iniciado"
else
  echo "  Baixando imagem onlyoffice/documentserver (pode demorar alguns minutos)..."
  docker run -d \
    --name onlyoffice \
    --restart=unless-stopped \
    -p 8080:80 \
    onlyoffice/documentserver
  ok "Container onlyoffice criado e iniciado"
fi

# ── Criar serviço systemd para auto-start ────────────────────
step "Configurando auto-start via systemd..."
cat > /etc/systemd/system/onlyoffice.service <<'UNIT'
[Unit]
Description=OnlyOffice Document Server (Docker)
Documentation=https://helpcenter.onlyoffice.com
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/bin/docker start onlyoffice
ExecStop=/usr/bin/docker stop onlyoffice

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable onlyoffice
ok "Serviço onlyoffice.service habilitado (inicia automaticamente após reboot)"

# ── Aguardar OnlyOffice ficar disponível ─────────────────────
step "Aguardando OnlyOffice ficar disponível (pode levar 1-3 minutos)..."
OO_OK=false
for i in $(seq 1 36); do
  sleep 5
  OO_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:8080/healthcheck" 2>/dev/null || echo "000")
  if [[ "$OO_STATUS" == "200" ]]; then
    OO_OK=true
    ok "OnlyOffice disponível: http://localhost:8080"
    break
  fi
  echo "  Tentativa $i/36: HTTP $OO_STATUS — aguardando..."
done
if [[ "$OO_OK" != "true" ]]; then
  warn "OnlyOffice não respondeu no tempo esperado."
  warn "Verifique: docker logs onlyoffice"
  warn "O VPS Drive funcionará normalmente — o botão Editar aparecerá quando o servidor estiver pronto."
fi

# ── Atualizar .env com URLs do OnlyOffice ────────────────────
step "Atualizando configuração do VPS Drive..."

# Atualizar ou adicionar ONLYOFFICE_URL
if grep -q "^ONLYOFFICE_URL=" "$ENV_FILE"; then
  sed -i "s|^ONLYOFFICE_URL=.*|ONLYOFFICE_URL=$ONLYOFFICE_URL|" "$ENV_FILE"
else
  echo "ONLYOFFICE_URL=$ONLYOFFICE_URL" >> "$ENV_FILE"
fi

# Atualizar ou adicionar VITE_ONLYOFFICE_URL (embutida no bundle do frontend)
if grep -q "^VITE_ONLYOFFICE_URL=" "$ENV_FILE"; then
  sed -i "s|^VITE_ONLYOFFICE_URL=.*|VITE_ONLYOFFICE_URL=$ONLYOFFICE_URL|" "$ENV_FILE"
else
  echo "VITE_ONLYOFFICE_URL=$ONLYOFFICE_URL" >> "$ENV_FILE"
fi

ok ".env atualizado: ONLYOFFICE_URL=$ONLYOFFICE_URL"

cd "$INSTALL_DIR"

# ── Verificar/corrigir pnpm ───────────────────────────────────
step "Verificando pnpm..."
if command -v pnpm &>/dev/null; then
  PNPM_MAJOR=$(pnpm --version 2>/dev/null | cut -d. -f1)
  if [ "${PNPM_MAJOR:-0}" -ge 11 ]; then
    echo "  pnpm v$(pnpm --version) — fazendo downgrade para v10..."
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

# ── Rebuild do frontend (VITE_ONLYOFFICE_URL é embutida no bundle) ───
step "Recompilando frontend com a nova URL do OnlyOffice..."

# Carregar variáveis do .env para o build
set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a

# Garantir pnpm.json e .npmrc para compatibilidade de builds
printf '{"onlyBuiltDependencies":["@swc/core","esbuild","msw","unrs-resolver"]}\n' > pnpm.json
grep -q "minimum-release-age" .npmrc 2>/dev/null \
  || echo "minimum-release-age=0" >> .npmrc

set +e
_fe_out=$(BASE_PATH=/ PORT=3000 NODE_ENV=production \
  pnpm --filter @workspace/vps-drive run build 2>&1); _fe_ec=$?
set -e
echo "$_fe_out" | tail -6
if [ $_fe_ec -ne 0 ]; then
  error "Falha no build do frontend (código $_fe_ec). Verifique as últimas linhas acima."
fi
ok "Frontend recompilado"

# ── Reiniciar PM2 para carregar novas variáveis ───────────────
step "Reiniciando servidor (PM2)..."
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

# ── Verificar saúde final ─────────────────────────────────────
step "Verificando servidor..."
sleep 4
for i in $(seq 1 10); do
  HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$APP_PORT/api/healthz" 2>/dev/null || echo "000")
  if [[ "$HTTP_STATUS" == "200" ]]; then
    ok "Servidor respondendo: HTTP $HTTP_STATUS"
    break
  fi
  if [[ $i -eq 10 ]]; then
    pm2 logs vps-drive-api --lines 15 --nostream 2>/dev/null || true
    error "Servidor não respondeu. Veja os logs acima."
  fi
  sleep 3
done

echo -e "
${BOLD}${GREEN}╔══════════════════════════════════════════════════╗
║   ✅  OnlyOffice instalado com sucesso!          ║
╚══════════════════════════════════════════════════╝${NC}
"
echo -e "  OnlyOffice:    ${CYAN}http://$VPS_HOST:8080${NC}"
echo -e "  Auto-start:    ${GREEN}systemctl status onlyoffice${NC}"
echo ""
echo -e "  Para verificar o serviço:   ${CYAN}systemctl status onlyoffice${NC}"
echo -e "  Para ver logs do container: ${CYAN}docker logs onlyoffice${NC}"
echo -e "  Para logs do VPS Drive:     ${CYAN}pm2 logs vps-drive-api${NC}"
echo ""
if [[ "$OO_OK" != "true" ]]; then
  echo -e "  ${YELLOW}⚠ OnlyOffice ainda está iniciando. Aguarde 1-3 minutos e recarregue o VPS Drive.${NC}"
fi
