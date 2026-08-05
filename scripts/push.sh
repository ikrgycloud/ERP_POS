#!/bin/bash

set -e

echo "====================================="
echo "Pushing Docker Images to ECR"
echo "====================================="

docker compose -f compose.build.yaml push

echo "====================================="
echo "Push Complete"
echo "====================================="
