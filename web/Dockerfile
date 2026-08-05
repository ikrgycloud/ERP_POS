FROM node:20-alpine AS build

WORKDIR /app

ARG EXPO_PUBLIC_API_URL=same-origin
ARG EXPO_PUBLIC_API_PORT=8001
ARG EXPO_PUBLIC_API_VERSION_PATH=/api/v1
ENV EXPO_PUBLIC_API_URL=${EXPO_PUBLIC_API_URL} \
    EXPO_PUBLIC_API_PORT=${EXPO_PUBLIC_API_PORT} \
    EXPO_PUBLIC_API_VERSION_PATH=${EXPO_PUBLIC_API_VERSION_PATH}

COPY web/package*.json ./
RUN npm ci

COPY web/ ./
RUN npm run deploy:build


FROM node:20-alpine

ENV ERP_API_UPSTREAM=http://erp-backend:8001 \
    ERP_CLIENT_MAX_BODY_SIZE=10m \
    ERP_STATIC_ROOT=/app/dist \
    PORT=80

WORKDIR /app

COPY web/server.mjs ./server.mjs
COPY --from=build /app/dist ./dist

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:' + (process.env.PORT || 80) + '/', r => process.exit(r.statusCode < 500 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "server.mjs"]
