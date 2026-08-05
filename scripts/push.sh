#!/bin/bash

set -e

echo "======================================="
echo "Pushing Images"
echo "======================================="

docker compose -f compose.build.yaml push

echo "Push Completed"
