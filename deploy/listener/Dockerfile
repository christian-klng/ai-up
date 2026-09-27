# AI-Up live listener (docs/live-ki-agenten.md). Debian, not Alpine: the LiveKit FFI bindings and
# onnxruntime (Silero VAD) ship glibc binaries only. Build context is the repository root, because the
# listener bundles the shared protocol module src/lib/live-listener.ts.
FROM node:24-slim AS build
WORKDIR /app
COPY listener/package.json listener/package-lock.json listener/
RUN cd listener && npm ci --no-audit --no-fund
COPY listener listener
COPY src/lib/live-listener.ts src/lib/live-listener.ts
RUN cd listener && npm run build && npm prune --omit=dev

FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app/listener
COPY --from=build /app/listener/package.json ./
COPY --from=build /app/listener/node_modules ./node_modules
COPY --from=build /app/listener/dist ./dist
USER node
# 8081: health endpoint of the agents server (GET / → "OK")
EXPOSE 8081
CMD ["node", "dist/index.js", "start"]
