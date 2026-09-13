FROM node:22-bookworm

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV NG_CLI_ANALYTICS=false

# Install Python 3, GDAL, Osmium, and required system build tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    git \
    python3 \
    python3-pip \
    python3-venv \
    python3-dev \
    gdal-bin \
    libgdal-dev \
    osmium-tool \
    python3-shapely \
    python3-pyproj \
    python3-requests \
    python3-pyosmium \
    && rm -rf /var/lib/apt/lists/*

# Install / verify required Python packages via pip
RUN pip install --no-cache-dir --break-system-packages \
    requests \
    shapely \
    pyproj \
    osmium

# Install Angular CLI globally
RUN npm install -g @angular/cli@21

WORKDIR /app

# Pre-install npm dependencies
COPY package.json package-lock.json ./
RUN npm install

# Copy application source code
COPY . .

# Expose Angular development server port
EXPOSE 4200

# Start development server
CMD ["npm", "start"]
