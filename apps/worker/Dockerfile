FROM node:22-bookworm-slim AS base
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @rizpoint/database prisma:generate && pnpm --filter @rizpoint/worker build
ENV NODE_ENV=production
USER node
CMD ["pnpm", "--filter", "@rizpoint/worker", "start"]
