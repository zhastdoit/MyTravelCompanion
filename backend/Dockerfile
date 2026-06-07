# SyncTrip Agent Server — Fly.io target.
#
# Build context: the `backend/` directory only. Build:
#   docker build -t synctrip-backend backend/
# Run locally:
#   docker run --rm -p 8000:8080 --env-file backend/.env synctrip-backend
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8080

WORKDIR /app

# Build deps for any wheels that need to compile (cryptography, etc.). We
# remove the build apt list afterwards to keep the layer thin.
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential curl \
 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /app/requirements.txt
RUN pip install --upgrade pip \
 && pip install -r requirements.txt

COPY . /app

# Run as a non-root user. Fly's machines have UID:GID 405:405 by convention,
# but any non-zero pair is fine.
RUN useradd --uid 1001 --create-home --shell /usr/sbin/nologin app \
 && chown -R app:app /app
USER app

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD curl -fsS "http://localhost:${PORT}/health" || exit 1

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT}"]
