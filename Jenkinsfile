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
        stage('Debug Workspace') {
    steps {
        sh '''
        echo "========================="
        echo "Workspace"
        echo "========================="
        pwd

        echo ""
        echo "========================="
        echo "Files"
        echo "========================="
        ls -la

        echo ""
        echo "========================="
        echo "Git Branch"
        echo "========================="
        git branch

        echo ""
        echo "========================="
        echo "compose.build.yaml"
        echo "========================="
        cat compose.build.yaml

        echo ""
        echo "========================="
        echo "Compose Images"
        echo "========================="
        docker compose -f compose.build.yaml config | grep image

        echo ""
        echo "========================="
        echo "Push Script"
        echo "========================="
        cat scripts/push.sh
        '''
    }
}

        stage('Login to Amazon ECR') {

            steps {

                withCredentials([
                    [
                        $class: 'AmazonWebServicesCredentialsBinding',
                        credentialsId: 'aws-ecr'
                    ]
                ]) {

                    sh '''
                    set -e

                    aws ecr get-login-password --region ${AWS_REGION} | \
                    docker login \
                    --username AWS \
                    --password-stdin ${ECR}
                    '''

                }

            }

        }
        stage('Debug') {
    steps {
        sh '''
        echo "===== Current Directory ====="
        pwd

        echo "===== Files ====="
        ls -la

        echo "===== compose.build.yaml ====="
        cat compose.build.yaml

        echo "===== Docker Compose Config ====="
        docker compose -f compose.build.yaml config | grep image

        echo "===== Build Script ====="
        cat scripts/build.sh

        echo "===== Push Script ====="
        cat scripts/push.sh
        '''
    }
}

        stage('Build Images') {

            steps {

                sh '''
                chmod +x scripts/build.sh
                ./scripts/build.sh
                '''

            }

        }

        stage('Push Images') {

            steps {

                sh '''
                chmod +x scripts/push.sh
                ./scripts/push.sh
                '''

            }

        }

        stage('Deploy To EC2') {

            steps {

                sshagent(credentials: ['app-server-ssh']) {

                    sh '''
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
Deployment Failed
===========================================
'''

        }

        always {

            cleanWs()

        }

    }

}
