FROM node:24-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      bash \
      ca-certificates \
      curl \
      dbus-x11 \
    ffmpeg \
      git \
      gnupg \
      jq \
      python3 \
      python3-pip \
      python3-venv \
    yt-dlp \
      unzip \
      x11-utils \
      xauth \
      xvfb \
      xz-utils && \
    rm -rf /var/lib/apt/lists/*

RUN npm install -g @openai/codex playwright && \
    playwright install --with-deps chromium

WORKDIR /workspace
CMD ["sleep", "infinity"]
