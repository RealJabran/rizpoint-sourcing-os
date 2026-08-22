FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV COREPACK_HOME=/opt/corepack
RUN apt-get update && \
    apt-get install --yes --no-install-recommends openssl && \
    rm -rf /var/lib/apt/lists/* && \
    corepack enable
COPY . .
RUN --mount=type=cache,id=rizpoint-pnpm-store,target=/pnpm/store,sharing=locked \
    pnpm config set store-dir /pnpm/store && \
    pnpm config set fetch-timeout 300000 && \
    pnpm config set fetch-retries 5 && \
    pnpm install --frozen-lockfile
# CSP is compiled by Next.js, so this public, non-secret browser origin is a
# build argument. Runtime S3 credentials and the internal endpoint stay in Compose.
ARG S3_PUBLIC_ENDPOINT=http://localhost:9000
ENV S3_PUBLIC_ENDPOINT=$S3_PUBLIC_ENDPOINT
ENV NODE_ENV=production
# Prisma resolves DATABASE_URL even for client generation. This non-secret ARG
# exists only while building; Compose supplies the real runtime connection.
ARG PRISMA_GENERATE_DATABASE_URL=postgresql://prisma_build:prisma_build@localhost:5432/prisma_build?schema=public
RUN DATABASE_URL="$PRISMA_GENERATE_DATABASE_URL" pnpm --filter @rizpoint/database prisma:generate && \
    pnpm --filter @rizpoint/amazon-sp-api build && \
    pnpm --filter @rizpoint/database build && \
    pnpm --filter @rizpoint/web build
RUN cp -R /app/apps/web/.next/static /app/apps/web/.next/standalone/apps/web/.next/static && \
    chown -R node:node /app/apps/web/.next /app/apps/web/next-env.d.ts
USER node
EXPOSE 3000
CMD ["node", "apps/web/.next/standalone/apps/web/server.js"]
