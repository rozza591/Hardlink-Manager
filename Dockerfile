# Dockerfile
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies including jdupes
RUN apt-get update && \
    apt-get install -y jdupes && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Expose the default port
EXPOSE 5000

# Set the default log level to INFO. This can be overridden when running the container.
ENV LOG_LEVEL=INFO

CMD ["python", "app.py"]
