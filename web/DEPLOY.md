# Web Deployment

This web app builds as static files from Expo.

## Backend

The deployed API is configured in `.env`:

```env
EXPO_PUBLIC_API_URL=https://erp.vee-gpt.com/api/v1
```

## Local Test

```cmd
cd /d "D:\react\ERP Project\web"
npm install
npm run web
```

Open:

```txt
http://localhost:5173
```

## Production Build

```cmd
cd /d "D:\react\ERP Project\web"
npm install
npm run deploy:build
```

Deploy the generated folder:

```txt
web\dist
```

Use a static host such as Nginx, S3 static hosting, Netlify, Vercel static output, or any file server.

## Docker Build

Build the web image:

```cmd
cd /d "D:\react\ERP Project\web"
docker build -t erp-web .
```

Run locally on port `5173`:

```cmd
docker run --rm -p 5173:80 --name erp-web erp-web
```

Open:

```txt
http://localhost:5173
```

Build with a different backend URL:

```cmd
docker build -t erp-web --build-arg EXPO_PUBLIC_API_URL=https://erp.vee-gpt.com/api/v1 .
```

Ubuntu deployment example:

```bash
cd "/path/to/ERP Project/web"
docker build -t erp-web .
docker run -d --restart unless-stopped --name erp-web -p 5173:80 erp-web
```
