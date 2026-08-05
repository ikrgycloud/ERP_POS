#!/bin/bash

set -e

echo "======================================"
echo "Pushing Images to Amazon ECR"
echo "======================================"

docker compose -f compose.build.yaml push

echo
echo "Push Completed Successfully"
