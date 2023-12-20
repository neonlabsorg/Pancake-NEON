FROM node:18-slim

RUN apt-get update && apt-get install -y \
    python3 make g++ wget jq git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

COPY package*.json ./
RUN yarn install --frozen-lockfile

COPY ./docker/entrypoint.sh /usr/local/bin
ENTRYPOINT ["/bin/sh", "/usr/local/bin/entrypoint.sh"]

COPY . ./