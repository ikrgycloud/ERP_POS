# ERP and POS shared Docker deployment

Run from ERP-main. The Compose file builds POS from the sibling POS-main
repository and starts both apps with one database.

For local use:

```powershell
docker compose up -d --build
```

Open ERP at http://localhost:8080 and POS at http://localhost:8081.

## AWS production

Use the commented AWS block in `.env` to switch from local URLs to HTTPS
domains. After DNS for both domains points to the server and AWS allows inbound
TCP ports 80 and 443, start the reverse proxy with:

```powershell
docker compose -f compose.yaml -f compose.aws.yaml up -d --build
```

Caddy obtains and renews HTTPS certificates automatically. Do not expose ports
8000, 8001, 8080, or 8081 publicly in the AWS security group.
