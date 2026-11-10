# Use the correct Home Assistant base image
ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:latest
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

# Copy the pre-built React app directly into the image
COPY dist/ ./mainmenu_public/

# Copy your startup script
COPY run.sh /
RUN chmod a+x /run.sh

CMD [ "/run.sh" ]