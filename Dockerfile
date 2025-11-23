# TickTick MCP Server - Genspark Compatible Docker Container
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apk add --no-cache \
    curl \
    bash \
    python3 \
    py3-pip \
    && rm -rf /var/cache/apk/*

# Copy package files
COPY package*.json ./

# Install Node.js dependencies
RUN npm install --production

# Copy source code
COPY src/ ./src/

# Create data and cache directories
RUN mkdir -p /app/data /root/.ticktick-cache

# Set permissions
RUN chmod +x /app/src/index.js

# Expose port (Railway and Genspark compatible)
EXPOSE 8007

# Environment variables for Genspark
ENV NODE_ENV=production
ENV PORT=8007

# Health check endpoints for both / and /health
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=5 \
    CMD curl -f http://localhost:8007/health || curl -f http://localhost:8007/ || exit 1

# Start the server
CMD ["npm", "start"]