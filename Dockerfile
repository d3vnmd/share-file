FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
COPY scripts ./scripts
COPY public ./public
COPY src ./src
RUN node scripts/build-assets.js
USER node
EXPOSE 3000
CMD ["node", "src/server.js"]
