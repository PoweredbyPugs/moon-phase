FROM node:18-bullseye

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    build-essential \
    g++ \
    make \
    pkg-config \
    cmake \
    && rm -rf /var/lib/apt/lists/*

# Set up Python environment for node-gyp
RUN python3 -m venv /app/.venv
ENV PATH="/app/.venv/bin:${PATH}"
RUN pip3 install setuptools wheel

# Set npm config for Python path
RUN npm config set python /app/.venv/bin/python3

# Copy package files first to leverage Docker cache
COPY package.json package-lock.json* ./

# Create ephemeris directory - this is where the .se1 files will go
RUN mkdir -p /app/ephemeris

# Install dependencies
RUN npm install

# Try to build the sweph module specifically
RUN cd node_modules/sweph && npm run build && cd ../..

# Copy the rest of the source code
COPY server.js ./

# Get Swiss Ephemeris files (.se1 files)
# Option 1: Download them during build
RUN apt-get update && apt-get install -y wget unzip \
    && mkdir -p /tmp/ephemeris \
    && cd /tmp/ephemeris \
    && wget https://www.astro.com/ftp/swisseph/ephe/se12000.zip \
    && unzip se12000.zip \
    && cp *.se1 /app/ephemeris/ \
    && rm -rf /tmp/ephemeris \
    && apt-get purge -y wget unzip \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

# Option 2: If you have custom ephemeris files, you may want to copy them from local storage
# COPY ephemeris_files/*.se1 /app/ephemeris/

# Expose the port the server will run on
EXPOSE 3000

# Command to run the server
CMD ["node", "server.js"]