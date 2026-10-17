FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci --include=dev

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev \
    && npx playwright install --with-deps chromium \
    && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY migrations ./migrations

RUN useradd --create-home --uid 10001 webwatch \
    && mkdir -p /data/screenshots \
    && chown -R webwatch:webwatch /app /data

USER webwatch
EXPOSE 8080

CMD ["node", "dist/index.js"]
