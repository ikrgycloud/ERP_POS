echo "========================"
echo "Docker Images"
echo "========================"
docker images

echo
echo "========================"
echo "Docker Compose Images"
echo "========================"
docker compose -f compose.build.yaml config | grep image

echo
echo "========================"
echo "ECR"
echo "========================"
echo "$ECR"

echo
echo "========================"
echo "IMAGE TAG"
echo "========================"
echo "$IMAGE_TAG"
