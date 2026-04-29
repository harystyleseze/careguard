FROM node:25-alpine AS base
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --legacy-peer-deps

# Copy source
COPY . .

EXPOSE 3004
CMD ["node", "--import", "tsx", "server.ts"]
