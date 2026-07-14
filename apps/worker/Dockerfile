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
# Prisma resolves DATABASE_URL even for client generation. This non-secret ARG
# exists only while building; Compose supplies the real runtime connection.
ARG PRISMA_GENERATE_DATABASE_URL=postgresql://prisma_build:prisma_build@localhost:5432/prisma_build?schema=public
RUN DATABASE_URL="$PRISMA_GENERATE_DATABASE_URL" pnpm --filter @rizpoint/database prisma:generate && pnpm --filter @rizpoint/worker build
ENV NODE_ENV=production
USER node
CMD ["pnpm", "--filter", "@rizpoint/worker", "start"]
