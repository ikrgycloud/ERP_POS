#!/bin/bash

set -e

echo "======================================="
echo "Pushing Images to ECR"
echo "======================================="

docker push ${ECR}/erp-backend:${IMAGE_TAG}
docker push ${ECR}/erp-frontend:${IMAGE_TAG}
docker push ${ECR}/pos-backend:${IMAGE_TAG}
docker push ${ECR}/pos-frontend:${IMAGE_TAG}

echo
echo "======================================="
echo "Push Completed Successfully"
echo "======================================="
