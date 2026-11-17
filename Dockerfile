FROM node:22-bookworm-slim AS build

WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY sign-language-server/package.json sign-language-server/package-lock.json ./sign-language-server/
RUN npm ci --prefix sign-language-server

COPY . .
RUN npm run build
RUN npm run build --prefix sign-language-server

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

COPY sign-language-server/package.json sign-language-server/package-lock.json ./sign-language-server/
COPY sign-language-server/prisma ./sign-language-server/prisma
RUN npm ci --include=dev --prefix sign-language-server
RUN npm run prisma:generate --prefix sign-language-server

COPY --from=build /app/sign-language-server/dist ./sign-language-server/dist
COPY --from=build /app/sign-language-server/public ./sign-language-server/public
COPY --from=build /app/dist ./dist

WORKDIR /app/sign-language-server
ENV NODE_ENV=production
ENV SERVE_CLIENT=true
ENV UPLOAD_DIR=/data/public

EXPOSE 3001
CMD ["npm", "run", "start:railway"]
