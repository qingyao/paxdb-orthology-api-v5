FROM node:20-alpine

WORKDIR /usr/src/app

ENV NEO4J_URL neo4j_url
ENV NEO4J_USER neo4j
ENV NEO4J_PASS neo4j

COPY package.json ./package.json
COPY package-lock.json ./package-lock.json

RUN npm ci

COPY . .

EXPOSE 3000

# USER app
CMD ["node", "app.js"]