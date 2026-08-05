#!/bin/bash

set -e

echo "======================================="
echo "Deploying Application"
echo "======================================="

ssh -o StrictHostKeyChecking=no ubuntu@${APP_SERVER} <<EOF

set -e

cd ${APP_PATH}

sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=${IMAGE_TAG}/" .env

aws ecr get-login-password --region ${AWS_REGION} | \
docker login \
--username AWS \
--password-stdin ${ECR}

docker compose -f compose.prod.yaml pull

docker compose -f compose.prod.yaml up -d --remove-orphans

docker image prune -f

docker ps

EOF

echo "Deployment Finished Successfully"
