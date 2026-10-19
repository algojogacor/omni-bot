FROM oven/bun:1-alpine

# Set Asia/Jakarta timezone
RUN apk add --no-cache tzdata && \
    cp /usr/share/zoneinfo/Asia/Jakarta /etc/localtime && \
    echo "Asia/Jakarta" > /etc/timezone

WORKDIR /app

# Copy dependency specifications
COPY package.json bun.lock* ./

# Install production dependencies
RUN bun install --production

# Copy application source
COPY tsconfig.json ./
COPY src ./src

# Create data directory for local sqlite fallback if needed
RUN mkdir -p /app/data

ENV PORT=8000
ENV NODE_ENV=production
ENV TZ=Asia/Jakarta

EXPOSE 8000

CMD ["bun", "run", "src/index.ts"]
