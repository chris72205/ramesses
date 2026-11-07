# Single-container image: NestJS backend serving the built Svelte app.
FROM node:26-alpine AS base
# Node 25+ no longer bundles corepack; install the pinned pnpm directly.
RUN npm install -g pnpm@12.18.0
WORKDIR /app

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc* ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
RUN pnpm --filter @ramesses/server --prod deploy /out/server

FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=3000
ENV WEB_DIST=/app/web
COPY --from=build /out/server /app
COPY --from=build /app/apps/web/dist /app/web
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:3000/api/health/live || exit 1
CMD ["node", "dist/main.js"]
