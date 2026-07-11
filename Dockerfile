# Stage 1: Build
FROM node:18-alpine AS builder
WORKDIR /app

# Copy monorepo configurations
COPY package.json yarn.lock tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/

# Install dependencies including build tools
RUN yarn install --frozen-lockfile --ignore-engines

# Copy sources
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api

# Build typescript projects
RUN yarn workspace @deadlock-live-probe/shared build
RUN yarn workspace @deadlock-live-probe/api build

# Stage 2: Production runtime
FROM node:18-alpine
WORKDIR /app

# Copy built artifacts and configurations from the builder stage
COPY --from=builder /app/package.json /app/yarn.lock ./
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/
COPY --from=builder /app/apps/api/dist ./apps/api/dist

# Install production dependencies only
RUN yarn install --production --frozen-lockfile --ignore-engines

WORKDIR /app/apps/api
EXPOSE 3000
ENV NODE_ENV=production

# Start NestJS API server
CMD ["node", "dist/src/main.js"]
