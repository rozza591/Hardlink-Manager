# Dockerfile
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Expose the default port
EXPOSE 5000

# Environment variables
ENV LOG_LEVEL=INFO
ENV CONFIG_DIR=/config
ENV PORT=5000
ENV PYTHONUNBUFFERED=1

# Ensure config directory exists
RUN mkdir -p /config

CMD ["python", "app.py"]
