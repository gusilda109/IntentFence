# Debian-based so Prisma's query engine finds OpenSSL without extra binaryTargets.
FROM node:24-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS build
# Cap the V8 heap so `next build` fits in a small Docker VM (8 GB host).
ENV NODE_OPTIONS=--max-old-space-size=1536
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM base AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_URL=file:/data/intentfence.db
# Full node_modules is kept on purpose: the Prisma CLI (a devDependency)
# runs the migrations on every container start.
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && exec npx next start -H 0.0.0.0 -p \"$PORT\""]
