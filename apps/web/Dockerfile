FROM node:22-bookworm-slim AS base
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @rizpoint/database prisma:generate && pnpm --filter @rizpoint/web build
ENV NODE_ENV=production
USER node
EXPOSE 3000
CMD ["pnpm", "--filter", "@rizpoint/web", "start"]
