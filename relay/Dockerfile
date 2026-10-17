FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
USER node
EXPOSE 8080
# Plain HTTP and WebSocket: TLS ends at the proxy in front, which must keep the
# `Upgrade` header and allow a request to wait 30 s.
CMD ["node", "src/server.js"]
