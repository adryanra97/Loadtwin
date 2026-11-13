# syntax=docker/dockerfile:1

# 1. Dashboard: static export of the Next.js app.
FROM node:22-slim AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web ./
COPY examples/loadtests /src/examples/loadtests
RUN npm run build

# 2. API and engine, serving the dashboard from the same origin.
FROM python:3.12-slim AS app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8000 \
    LOADTWIN_WEB_DIR=/app/web

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY loadtwin ./loadtwin
COPY --from=web /src/web/out ./web
RUN useradd --create-home --uid 10001 loadtwin
USER loadtwin

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD python -c "import os, urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\", \"8000\")}/api/health', timeout=2)"
CMD ["sh", "-c", "uvicorn loadtwin.api:app --host 0.0.0.0 --port ${PORT} --proxy-headers"]
