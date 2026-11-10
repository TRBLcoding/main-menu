#!/usr/bin/with-contenv bashio
bashio::log.info "Reading Home Assistant Configuration..."

# 1. Read the variables from the Home Assistant UI
GEMINI_KEY=$(bashio::config 'gemini_api_key')
LOGIN_EMAIL=$(bashio::config 'auto_login_email')
LOGIN_PASS=$(bashio::config 'auto_login_password')

# 2. Write them to a JavaScript file inside your React public folder
cat <<EOF > /app/mainmenu_public/ha-config.js
window.HA_CONFIG = {
  GEMINI_API_KEY: "${GEMINI_KEY}",
  AUTO_LOGIN_EMAIL: "${LOGIN_EMAIL}",
  AUTO_LOGIN_PASSWORD: "${LOGIN_PASS}"
};
EOF

bashio::log.info "Starting MainMenu Backend & Frontend..."

# 3. Start PocketBase
/usr/local/bin/main-menu-pocketbase serve \
    --http=0.0.0.0:8099 \
    --dir=/data/mainmenu_data \
    --publicDir=/app/mainmenu_public