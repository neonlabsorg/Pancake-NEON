FROM node:18-slim

RUN apt-get update && apt-get install -y \
    python3 make g++ wget jq git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

COPY . ./

RUN yarn install --frozen-lockfile
ENV PATH /usr/src/app/node_modules/.bin:$PATH
RUN lerna exec npm install --stream

ENTRYPOINT ["/bin/sh", "/usr/src/app/docker/entrypoint.sh"]