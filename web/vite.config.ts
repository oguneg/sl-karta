import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative asset paths so the build also works inside Capacitor's native webview.
  base: './',
  // maplibre-gl v6 loads an ES-module worker; bundle it ourselves (see src/components/MapView.tsx).
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['maplibre-gl'] },
  server: {
    port: 5173,
    strictPort: true,
    host: true,
    proxy: { '/api': 'http://localhost:8787' },
    fs: { allow: ['..'] },
  },
});
