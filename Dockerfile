# Stage 1: Build frontend
FROM node:18-alpine AS frontend-builder
WORKDIR /build
COPY src/frontend/package*.json ./
RUN npm install
COPY src/frontend/ ./
RUN npm run build

# Stage 2: Install backend dependencies
FROM node:18-alpine AS backend-builder
WORKDIR /build
COPY src/backend/package*.json ./
RUN npm install
COPY src/backend/ ./
RUN npm run build

# Stage 3: Production runtime
FROM node:18-alpine

# Install fonts for sharp SVG rendering
RUN apk add --no-cache fontconfig font-dejavu

WORKDIR /app

# Copy backend
COPY --from=backend-builder /build/dist ./dist
COPY --from=backend-builder /build/node_modules ./node_modules
COPY --from=backend-builder /build/package.json ./

# Copy frontend build
COPY --from=frontend-builder /build/dist ./frontend-dist

# Create data directory
RUN mkdir -p /app/data

ENV PORT=3000
EXPOSE 3000

CMD ["node", "dist/server.js"]
