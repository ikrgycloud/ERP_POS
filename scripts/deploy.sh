#!/bin/bash

set -e

SERVER=$1

echo "Deploying to ${SERVER}"

ssh -o StrictHostKeyChecking=no ubuntu@${SERVER} << EOF

set -e

cd /opt/business-platform

sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=${BUILD_NUMBER}/" .env

aws ecr get-login-password --region eu-north-1 | \
docker login \
--username AWS \
--password-stdin \
032844082845.dkr.ecr.eu-north-1.amazonaws.com

docker compose -f compose.prod.yaml pull

docker compose -f compose.prod.yaml up -d --remove-orphans

docker image prune -af

docker ps

EOF
