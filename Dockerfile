FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY tsconfig.json tsconfig.server.json ./
COPY src/server ./src/server
COPY src/shared ./src/shared
RUN npm run build:server && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001 DATA_DIR=/app/data SERVE_FRONTEND=false
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist/server ./dist/server
COPY fixtures ./fixtures
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/api/system/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# The base image's /bin/sh entrypoint drops env names starting with digits.
# Start Node directly so the requested 511_API_KEY name reaches process.env.
ENTRYPOINT []
CMD ["node", "dist/server/server/index.js"]
