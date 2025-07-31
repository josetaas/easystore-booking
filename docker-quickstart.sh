#!/bin/bash

# Docker Quickstart Script for Booking System

echo "🚀 Starting Steps & Stories Booking System Setup..."

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    echo "Visit: https://docs.docker.com/get-docker/"
    exit 1
fi

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose is not installed. Please install Docker Compose first."
    echo "Visit: https://docs.docker.com/compose/install/"
    exit 1
fi

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    echo "📝 Creating .env file from template..."
    cp .env.example .env
    echo "⚠️  Please edit .env file with your Google Calendar credentials before continuing."
    echo "Press Enter when ready..."
    read
fi

# Create necessary directories
echo "📁 Creating necessary directories..."
mkdir -p data logs backups nginx/ssl

# Build and start containers
echo "🏗️  Building Docker containers..."
docker-compose build

echo "🚀 Starting services..."
docker-compose up -d

# Wait for services to be ready
echo "⏳ Waiting for services to start..."
sleep 10

# Check health status
echo "🏥 Checking service health..."
docker-compose ps

# Test the API
echo "🧪 Testing API endpoint..."
curl -s http://localhost:3000/health | jq '.' || echo "API is starting up..."

echo "✅ Setup complete!"
echo ""
echo "📍 Access points:"
echo "   - API: http://localhost:3000"
echo "   - Health Check: http://localhost:3000/health"
echo "   - Database Viewer: http://localhost:8080 (if using development profile)"
echo ""
echo "📝 Useful commands:"
echo "   - View logs: docker-compose logs -f app"
echo "   - Stop services: docker-compose down"
echo "   - Restart services: docker-compose restart"
echo "   - Enter container: docker-compose exec app sh"
echo ""
echo "🔍 Check CLAUDE.md for more details!"