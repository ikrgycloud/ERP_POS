stage('Verify Deployment') {

    steps {

        sshagent(credentials: ['app-server-ssh']) {

            sh """
ssh -o StrictHostKeyChecking=no ubuntu@${APP_SERVER} <<EOF
cd ${APP_PATH}

echo ""
echo "====================================="
echo "Running Containers"
echo "====================================="
docker ps

echo ""
echo "====================================="
echo "Container Health"
echo "====================================="
docker compose -f compose.prod.yaml ps

echo ""
echo "====================================="
echo "Application URLs"
echo "====================================="
echo "ERP  : http://${APP_SERVER}:82"
echo "POS  : http://${APP_SERVER}:83"

EOF
"""

        }

    }

}
