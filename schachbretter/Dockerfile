FROM node:22-alpine
WORKDIR /app
COPY package.json server.js ./
COPY public ./public
# /data ist in Home-Assistant-Add-ons das persistente Verzeichnis
ENV DATA_DIR=/data PORT=8099
EXPOSE 8099
CMD ["node", "server.js"]
