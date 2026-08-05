FROM node:20-alpine AS build

WORKDIR /app

ARG VITE_API_URL=auto
ARG VITE_API_PORT=8000
ARG VITE_API_VERSION_PATH=/api/v1
ARG VITE_REQUEST_TIMEOUT_MS=15000
ENV VITE_API_URL=${VITE_API_URL} \
    VITE_API_PORT=${VITE_API_PORT} \
    VITE_API_VERSION_PATH=${VITE_API_VERSION_PATH} \
    VITE_REQUEST_TIMEOUT_MS=${VITE_REQUEST_TIMEOUT_MS}

COPY POS-Frontend/package*.json ./
RUN npm ci

COPY POS-Frontend/ ./
RUN npm run build


FROM node:20-alpine

ENV POS_API_UPSTREAM=http://pos-backend:8000 \
    POS_CLIENT_MAX_BODY_SIZE=10m \
    POS_STATIC_ROOT=/app/dist \
    PORT=80

WORKDIR /app

COPY POS-Frontend/server.mjs ./server.mjs
COPY --from=build /app/dist ./dist

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:' + (process.env.PORT || 80) + '/', r => process.exit(r.statusCode < 500 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "server.mjs"]
