# SwissEphemeris Server Setup Guide

This guide explains how to set up and run your SwissEphemeris moon phase server using Docker. The server provides moon phase data for your Obsidian plugin.

## Prerequisites

- [Docker](https://www.docker.com/get-started) installed on your system
- [Docker Compose](https://docs.docker.com/compose/install/) (optional but recommended)
- Basic knowledge of terminal/command line

## Setup Instructions

### 1. Create the Project Directory

```bash
mkdir -p sweph-server
cd sweph-server
```

### 2. Create Required Files

Create the following files in your project directory:

- `Dockerfile` - Instructions for building the Docker image
- `docker-compose.yml` - For managing the Docker container (optional but recommended)
- `server.js` - Your SwissEphemeris server code (already provided in your files)
- `package.json` - For managing Node.js dependencies

#### Create package.json

```bash
cat > package.json << 'EOF'
{
  "name": "sweph-server",
  "version": "1.0.0",
  "description": "SwissEphemeris moon phase server for Obsidian",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "cors": "^2.8.5",
    "sweph": "^2.10.3",
    "moment-timezone": "^0.5.43"
  }
}
EOF
```

### 3. Build and Run with Docker Compose

The simplest way to get everything running is with Docker Compose:

```bash
docker-compose up -d
```

This will:
1. Build the Docker image with all dependencies
2. Create and start a container running your server
3. Make it available on port 3000

### 4. Alternative: Build and Run with Docker Commands

If you're not using Docker Compose:

```bash
# Build the Docker image
docker build -t sweph-server .

# Run the container
docker run -d --name sweph-server -p 3000:3000 sweph-server
```

### 5. Verify the Server is Running

Test your server by accessing one of the endpoints:

```bash
curl http://localhost:3000/moon-now
```

You should receive a JSON response with the current moon phase data.

## Customization Options

### Network Configuration

If your Obsidian plugin is having trouble connecting to the server, you may need to:

1. Make sure your Obsidian plugin is pointing to the correct IP address and port:
   - If running on the same machine: `http://localhost:3000` or `http://127.0.0.1:3000` 
   - If running on a different machine: `http://<server-ip>:3000`

2. Uncomment the `network_mode: "host"` line in docker-compose.yml if you're running the server on the same machine as Obsidian. This makes the server directly accessible on localhost without port mapping.

### Ephemeris Files

The Dockerfile automatically downloads a basic set of SwissEphemeris files, but you can use your own:

1. Create an `ephemeris` directory in your project folder
2. Copy your `.se1` files into that directory
3. Uncomment the volume mount line in the docker-compose.yml file

## Troubleshooting

### Server Won't Start

Check the logs for error messages:

```bash
docker logs sweph-server
```

Common issues:
- Missing dependencies: Make sure the package.json has all required dependencies
- Port conflict: Change the port mapping in docker-compose.yml if port 3000 is already in use
- Ephemeris files: Make sure the ephemeris directory exists and contains valid .se1 files

### Connection Issues from Obsidian

1. Check if the server is accessible from the host:
   ```bash
   curl http://localhost:3000/moon-now
   ```

2. Verify your Obsidian plugin is using the correct URL
   - If your server is running on a different machine, you need to use that machine's IP address
   - Make sure no firewalls are blocking port 3000

3. Try using the host network mode in Docker to simplify networking

## Maintenance

### Updating the Server

If you make changes to the server.js file:

```bash
docker-compose down
docker-compose up -d --build
```

### Viewing Logs

```bash
docker-compose logs -f
```

### Stopping the Server

```bash
docker-compose down
```