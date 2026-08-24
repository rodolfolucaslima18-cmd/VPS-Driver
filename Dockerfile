FROM node:22-slim

WORKDIR /app

RUN apt-get update -qq && \
    apt-get install -y -qq curl openssl git ca-certificates gnupg && \
    install -m 0755 -d /etc/apt/keyrings && \
    curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg && \
    chmod a+r /etc/apt/keyrings/docker.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian bookworm stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null && \
    apt-get update -qq && \
    apt-get install -y -qq docker-ce-cli docker-compose-plugin && \
    rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@10 --quiet

# Copia o código da aplicação do repositório (substitui o download do Replit)
COPY app/ .

RUN printf '{"onlyBuiltDependencies":["@swc/core","esbuild","msw","unrs-resolver"]}\n' > pnpm.json

RUN pnpm install --frozen-lockfile 2>/dev/null || pnpm install

ARG VITE_ONLYOFFICE_URL=""
ENV VITE_ONLYOFFICE_URL=${VITE_ONLYOFFICE_URL}

RUN BASE_PATH=/ PORT=3000 NODE_ENV=production \
    pnpm --filter @workspace/vps-drive run build && \
    pnpm --filter @workspace/api-server run build

EXPOSE 5000

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
