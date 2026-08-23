# Deploy this on Render (or any Docker host) as a Web Service.
# Guarantees ffmpeg is present — pydub/Whisper need it, and it's not
# reliably included in every platform's native Python buildpack.
FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Assumes a single requirements.txt at the repo root (next to main.py)
# with all dependencies merged in — both your pipeline's and the ones in
# requirements-api.txt from this project.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Render injects $PORT at runtime; default to 8000 for local `docker run`.
ENV PORT=8000
CMD uvicorn api_server:app --host 0.0.0.0 --port ${PORT}