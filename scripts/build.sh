#!/bin/bash

set -e

echo "======================================"
echo "Building Docker Images"
echo "======================================"

docker compose -f compose.build.yaml build

echo
echo "Build Completed Successfully"
