FROM node:22-bookworm-slim

# Display fonts (retro script, block, bubbly) give designs a shop look; see FONT_GUIDE in designStyles.ts.
# Fonts are required: designs are SVG text rendered to PNG, and without
# system fonts every design comes out blank. OpenSSL is needed by Prisma,
# ffmpeg makes the listing videos.
RUN apt-get update \
  && apt-get install -y --no-install-recommends fonts-dejavu fonts-liberation fonts-noto-core \
     fonts-lobstertwo fonts-dancingscript fonts-bebas-neue fonts-league-spartan fonts-staypuft fonts-yanone-kaffeesatz \
     openssl ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json ./
COPY src ./src

ENV NODE_ENV=production
# exec makes node itself the main process, so Railway's stop signal (SIGTERM) reaches the
# server and it shuts down cleanly instead of being reported as a crash on every deploy.
CMD ["sh", "-c", "npx prisma migrate deploy && exec node --import tsx src/server.ts"]
