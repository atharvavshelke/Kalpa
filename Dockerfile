FROM node:20-alpine AS base

WORKDIR /app

# Install dependencies
COPY package*.json ./
COPY packages/core/package.json packages/core/
COPY packages/cli/package.json packages/cli/
COPY packages/adapters/http/package.json packages/adapters/http/
COPY packages/adapters/websocket/package.json packages/adapters/websocket/
COPY packages/adapters/tcp/package.json packages/adapters/tcp/
COPY packages/adapters/sse/package.json packages/adapters/sse/
COPY packages/adapters/mqtt/package.json packages/adapters/mqtt/
COPY packages/adapters/grpc/package.json packages/adapters/grpc/
RUN npm ci --omit=dev

# Copy source
COPY packages/ packages/
COPY tsconfig.base.json ./

EXPOSE 3000 3001 4000 4001 50051

ENTRYPOINT ["npx", "tsx", "packages/cli/src/cli.ts"]
CMD ["start", "--config", "/config/kalpa.yml"]
