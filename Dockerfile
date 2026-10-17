FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app

COPY package*.json ./
RUN npm ci && npx playwright install --with-deps chromium

COPY tsconfig.json ./
COPY src ./src
COPY migrations ./migrations
RUN npm run build && npm prune --omit=dev

RUN useradd --create-home --uid 10001 webwatch \
    && mkdir -p /data/screenshots \
    && chown -R webwatch:webwatch /app /data

USER webwatch
EXPOSE 8080

CMD ["node", "dist/index.js"]
