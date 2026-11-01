# OrgMarket — self-hostable image (D20). Multi-stage: build the Next.js
# standalone server, then ship only what it needs, running as non-root.
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY . .
RUN npm run build -w @orgmarket/web

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1
RUN addgroup -S orgmarket && adduser -S orgmarket -G orgmarket
COPY --from=build --chown=orgmarket:orgmarket /repo/apps/web/.next/standalone ./
COPY --from=build --chown=orgmarket:orgmarket /repo/apps/web/.next/static ./apps/web/.next/static
USER orgmarket
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:3000/login >/dev/null || exit 1
CMD ["node", "apps/web/server.js"]
