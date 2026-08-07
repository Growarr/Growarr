FROM node:24-alpine
WORKDIR /app
COPY package.json server.js index.html logo.png ./
COPY src ./src
ENV PORT=8097 DATA_PATH=/data/tradgard.json
EXPOSE 8097
CMD ["node", "server.js"]
