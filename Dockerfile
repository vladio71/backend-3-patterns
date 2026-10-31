# Етап 1: збірка TypeScript. Етап 2: лише dist і production-залежності.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY scripts ./scripts
COPY scheme ./scheme
COPY public ./public
COPY docs/architecture.excalidraw ./docs/architecture.excalidraw
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
USER node
EXPOSE 3002
CMD ["node", "dist/src/main.js"]
