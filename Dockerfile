# Dockerfile
# Use official Node.js 20 LTS Alpine image for minimal attack surface and lightweight memory footprint
FROM node:20-alpine AS base

# Set working directory inside container
WORKDIR /app

# Copy package dependency manifests
COPY package*.json ./

# Install production and development dependencies
RUN npm ci

# Copy remaining application source code
COPY . .

# Expose HTTP application port
EXPOSE 3000

# Set environment to production
ENV NODE_ENV=production

# Start application server using node entrypoint
CMD ["node", "server.js"]