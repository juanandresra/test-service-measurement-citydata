FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN corepack enable && yarn install --non-interactive --no-lockfile

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG DATABASE_URL
ENV DATABASE_URL=$DATABASE_URL

RUN corepack enable \
    && yarn prisma:generate:mea \
    && yarn build

FROM node:22-alpine AS prod-deps
WORKDIR /app
COPY package.json ./
RUN corepack enable \
    && yarn install --non-interactive --no-lockfile --production \
    && yarn cache clean \
    && rm -rf node_modules/typescript \
    && rm -rf node_modules/@electric-sql \
    && rm -rf node_modules/chart.js \
    && find node_modules -name "*.md" -delete \
    && find node_modules -name "*.d.ts" -delete \
    && find node_modules -name "*.map" -delete \
    && find node_modules -name "LICENSE*" -delete \
    && find node_modules -name "CHANGELOG*" -delete

FROM node:22-alpine AS runner
WORKDIR /app
COPY package.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma/measurement/generated ./prisma/measurement/generated

EXPOSE 4001
CMD ["sh", "-c", "yarn prisma:push:mea && yarn start:prod"]
