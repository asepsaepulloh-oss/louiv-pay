FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3-venv git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements-shopee.txt package.json ./
RUN python3 -m venv /opt/louiv && /opt/louiv/bin/pip install --no-cache-dir -r requirements-shopee.txt && npm install --omit=dev
COPY . .
ENV SHOPEE_LOGIN_DRIVER=python PYTHON_BIN=/opt/louiv/bin/python
USER node
CMD ["node","server.js"]
