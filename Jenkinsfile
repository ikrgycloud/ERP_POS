pipeline {

    agent any

    environment {

        AWS_REGION = "eu-north-1"
        AWS_ACCOUNT_ID = "032844082845"

        ECR = "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

        IMAGE_TAG = "${BUILD_NUMBER}"

        APP_SERVER = "16.16.216.155"
        APP_PATH = "/opt/business-platform"
    }

    options {
        timestamps()
        disableConcurrentBuilds()
    }

    stages {

        stage('Checkout') {
            steps {
                checkout scm
            }
        }


        stage('Validate') {
            steps {
                sh '''
                    set -e

                    echo "Checking repository..."

                    test -f compose.build.yaml
                    test -f compose.prod.yaml
                    test -f scripts/build.sh
                    test -f scripts/push.sh
                    test -f scripts/deploy.sh

                    echo "Repository validation successful."
                '''
            }
        }


        stage('Login to ECR') {
            steps {

                withCredentials([
                    [
                        $class: 'AmazonWebServicesCredentialsBinding',
                        credentialsId: 'aws-ecr'
                    ]
                ]) {

                    sh '''
                        set -e

                        aws ecr get-login-password \
                            --region ${AWS_REGION} | \
                        docker login \
                            --username AWS \
                            --password-stdin ${ECR}
                    '''
                }
            }
        }


        stage('Build Images') {
            steps {

                sh '''
                    set -e

                    chmod +x scripts/build.sh

                    ./scripts/build.sh
                '''
            }
        }


        stage('Push Images') {
            steps {

                sh '''
                    set -e

                    chmod +x scripts/push.sh

                    ./scripts/push.sh
                '''
            }
        }


        stage('Deploy To EC2') {
            steps {

                sshagent(credentials: ['app-server-ssh']) {

                    sh '''
                        set -e

                        chmod +x scripts/deploy.sh

                        ./scripts/deploy.sh
                    '''
                }
            }
        }


        stage('Verify Deployment') {
            steps {

                sshagent(credentials: ['app-server-ssh']) {

                    sh '''
                        set -e

                        ssh -o StrictHostKeyChecking=no \
                            ubuntu@${APP_SERVER} <<EOF

                        cd ${APP_PATH}

                        echo ""
                        echo "====================================="
                        echo "Container Status"
                        echo "====================================="

                        docker compose \
                            -f compose.prod.yaml \
                            ps

                        echo ""
                        echo "====================================="
                        echo "Running Containers"
                        echo "====================================="

                        docker ps

                        echo ""
                        echo "====================================="
                        echo "ERP URL"
                        echo "====================================="

                        echo "http://${APP_SERVER}:82"

                        echo ""
                        echo "====================================="
                        echo "POS URL"
                        echo "====================================="

                        echo "http://${APP_SERVER}:83"

EOF
                    '''
                }
            }
        }
    }


    post {

        success {

            echo '''
===========================================
ERP + POS Deployment Successful
===========================================
'''
        }

        failure {

            echo '''
===========================================
ERP + POS Deployment Failed
===========================================
'''
        }
    }
}
