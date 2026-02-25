FROM node:20-bookworm-slim AS deps

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-bookworm-slim AS prod-deps

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:20-bookworm-slim AS builder

WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY app ./app
COPY public ./public
COPY src ./src
COPY server.js ./server.js
COPY next.config.js ./next.config.js
COPY package.json ./package.json
COPY tsconfig.json ./tsconfig.json
COPY next-env.d.ts ./next-env.d.ts

RUN npm run build

FROM node:20-bookworm-slim AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY app ./app
COPY public ./public
COPY src ./src
COPY server.js ./server.js
COPY next.config.js ./next.config.js
COPY package.json ./package.json

RUN mkdir -p /home/node/.local/share/AutoZap && chown -R node:node /home/node /app

USER node
EXPOSE 3000

CMD ["node", "server.js"]
