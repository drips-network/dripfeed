FROM node:22-bookworm

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

ARG NETWORK
ENV NETWORK=${NETWORK}

ARG SKIP_BUILD=false

RUN if [ "$SKIP_BUILD" = "false" ]; then npm run build; fi

CMD ["npm", "run", "start"]
