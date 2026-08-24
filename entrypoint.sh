#!/bin/sh
set -e

echo "▶ Aplicando schema do banco de dados..."
pnpm --filter @workspace/db run push-force
echo "✓ Schema aplicado"

echo "▶ Copiando frontend para volume compartilhado..."
mkdir -p /frontend
cp -r /app/artifacts/vps-drive/dist/public/. /frontend/
echo "✓ Frontend copiado"

echo "▶ Iniciando VPS Drive API na porta ${PORT:-5000}..."
exec node /app/artifacts/api-server/dist/index.mjs
