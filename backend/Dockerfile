FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    TRUSTED_HOSTS=erp.vee-gpt.com,erp-backend,127.0.0.1,localhost


# Set working directory
WORKDIR /app

# Install the ERP-owned shared business-domain package first.
COPY shared_domain ./shared_domain
RUN pip install --no-cache-dir ./shared_domain

# Install ERP-specific dependencies and then the application code.
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend .

# Expose the default port; override with PORT at runtime when needed.
EXPOSE 8001

# Command to run the application
CMD ["python", "-m", "app.server"]
