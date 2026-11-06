#!/bin/bash
# Renova o certificado Let's Encrypt (quando estiver perto de expirar) e,
# se houve renovação, recarrega o nginx para usar o certificado novo.
set -e
cd /opt/vps-drive-repo

OUTPUT=$(docker run --rm \
  -v "$(pwd)/certbot/conf:/etc/letsencrypt" \
  -v "$(pwd)/certbot/www:/var/www/certbot" \
  certbot/certbot renew --webroot -w /var/www/certbot --quiet 2>&1)

echo "$OUTPUT"

if echo "$OUTPUT" | grep -q "Congratulations"; then
  docker exec vps-drive-repo-nginx-1 nginx -s reload
  echo "Certificado renovado — nginx recarregado."
fi
