#!/bin/sh
set -eu
mkdir -p /etc/nginx/certs /var/www/certbot
if [ ! -s /etc/nginx/certs/fullchain.pem ] || [ ! -s /etc/nginx/certs/privkey.pem ]; then
  apk add --no-cache openssl >/dev/null
  openssl req -x509 -nodes -newkey rsa:2048 -days 30 \
    -keyout /etc/nginx/certs/privkey.pem \
    -out /etc/nginx/certs/fullchain.pem \
    -subj "/CN=gradtrack.local"
fi
if [ -z "${CAMPUS_CIDR:-}" ] || [ "${CAMPUS_CIDR}" = "all" ]; then
  RULES="allow all;"
else
  RULES="allow ${CAMPUS_CIDR}; deny all;"
fi
sed "s|__ALLOW_RULES__|${RULES}|" /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf
exec nginx -g 'daemon off;'
