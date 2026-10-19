FROM node:22-bookworm-slim

# Fonts are required: designs are SVG text rendered to PNG, and without
# system fonts every design comes out blank. OpenSSL is needed by Prisma.
RUN apt-get update \
  && apt-get install -y --no-install-recommends fonts-dejavu fonts-liberation fonts-noto-core openssl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json ./
COPY src ./src

ENV NODE_ENV=production
CMD ["npm", "start"]
