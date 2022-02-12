FROM node:lts-bullseye as ts-compiler
WORKDIR /app

COPY package*.json ./
RUN npm ci
COPY src ./src
COPY tsconfig.json ./
RUN ls -la && npm run build

FROM node:lts-bullseye as ts-remover
WORKDIR /app

COPY --from=ts-compiler /app/package*.json ./
RUN npm ci --only=production
COPY --from=ts-compiler /app/dist ./dist

FROM node:lts-bullseye
WORKDIR /app
ENV NODE_ENV=production
COPY --from=ts-remover /app ./

USER 1000
EXPOSE 3000
CMD ["dist/index.js"]