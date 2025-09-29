#!/bin/bash

# Install Docker if not present
if ! command -v docker &> /dev/null; then
    echo "Installing Docker..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh
    sudo usermod -aG docker $USER
    echo "Please logout and login again to use Docker without sudo"
    exit 1
fi

# Install NVIDIA Container Toolkit
if ! command -v nvidia-container-runtime &> /dev/null; then
    echo "Installing NVIDIA Container Toolkit..."
    distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
    curl -s -L https://nvidia.github.io/nvidia-docker/gpgkey | sudo apt-key add -
    curl -s -L https://nvidia.github.io/nvidia-docker/$distribution/nvidia-docker.list | sudo tee /etc/apt/sources.list.d/nvidia-docker.list
    sudo apt-get update && sudo apt-get install -y nvidia-container-toolkit
    sudo systemctl restart docker
fi

# Stop local Ollama service
sudo systemctl stop ollama

# Start Ollama in Docker
docker compose up -d

echo "Ollama is running in Docker on http://localhost:11434"
echo "Pull models with: docker exec -it ollama ollama pull phi4:latest"
echo "Run models with: docker exec -it ollama ollama run phi4:latest"