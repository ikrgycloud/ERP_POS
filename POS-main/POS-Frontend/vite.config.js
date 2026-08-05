import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const backendTarget = env.VITE_DEV_PROXY_TARGET
  const proxy = {
    ...(backendTarget
      ? {
          '/api': { target: backendTarget, changeOrigin: true },
          '/health': { target: backendTarget, changeOrigin: true },
        }
      : {}),
  }

  return {
    plugins: [react()],
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom', 'react-router-dom'],
            barcode: ['jsbarcode', 'qrcode'],
            icons: ['lucide-react'],
          },
        },
      },
    },
    server: {
      port: 5173,
      host: '0.0.0.0',
      // Allow all hosts (disables Vite host blocking). Use only for development.
      allowedHosts: true,
      proxy,
    },
    preview: {
      port: 5173,
      host: '0.0.0.0',
      // The app is served in AWS via `vite preview`, so allow the load balancer host.
      allowedHosts: true,
      proxy,
    },
  }
})
