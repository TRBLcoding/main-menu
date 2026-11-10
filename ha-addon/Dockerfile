# Hardcode the correct base image directly
FROM ghcr.io/home-assistant/amd64-base:latest

RUN apk add --no-cache unzip wget libc6-compat

# Fetch latest pocketbase
RUN LATEST_TAG=$(curl -s https://api.github.com/repos/pocketbase/pocketbase/releases/latest | jq -r '.tag_name') \
    && PB_VERSION=${LATEST_TAG#v} \
    && wget https://github.com/pocketbase/pocketbase/releases/download/${LATEST_TAG}/pocketbase_${PB_VERSION}_linux_amd64.zip \
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