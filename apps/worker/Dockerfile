FROM node:22-bookworm-slim AS base
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
# Prisma resolves DATABASE_URL even for client generation. This non-secret ARG
# exists only while building; Compose supplies the real runtime connection.
ARG PRISMA_GENERATE_DATABASE_URL=postgresql://prisma_build:prisma_build@localhost:5432/prisma_build?schema=public
RUN DATABASE_URL="$PRISMA_GENERATE_DATABASE_URL" pnpm --filter @rizpoint/database prisma:generate && pnpm --filter @rizpoint/worker build
ENV NODE_ENV=production
USER node
CMD ["pnpm", "--filter", "@rizpoint/worker", "start"]
