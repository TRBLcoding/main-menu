ARG BUILD_FROM=ghcr.io/home-assistant/alpine-base:latest

# --- STAGE 1: Build the React App ---
FROM node:20-alpine AS frontend-builder
WORKDIR /app

# Copy package files and install dependencies first (optimized for caching)
COPY ../package*.json ./
RUN npm ci

# Copy the rest of your React source code from the root directory
COPY ../src ./src
COPY ../index.html ./
COPY ../vite.config.js ./ 
COPY ../postcss.config.js ./
COPY ../tailwind.config.js ./

# Build your Vite app into the /app/dist folder
RUN npm run build 

# --- STAGE 2: Build the Final Home Assistant Add-on ---
FROM $BUILD_FROM
RUN apk add --no-cache unzip wget libc6-compat

# Download PocketBase
ARG PB_VERSION=0.22.25
RUN wget https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip \
    && unzip pocketbase_${PB_VERSION}_linux_amd64.zip \
    && chmod +x pocketbase \
    && mv pocketbase /usr/local/bin/main-menu-pocketbase \
    && rm pocketbase_${PB_VERSION}_linux_amd64.zip

WORKDIR /app

# Copy the built React app from Stage 1 into PocketBase's public folder
COPY --from=frontend-builder /app/dist ./mainmenu_public/

# Copy your startup script
COPY run.sh /
RUN chmod a+x /run.sh

CMD [ "/run.sh" ]