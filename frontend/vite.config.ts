import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Forward API calls to the ASP.NET backend (launchSettings "http" profile) so no CORS setup is needed in dev.
    proxy: { '/api': { target: 'http://localhost:5146', changeOrigin: true } },
  },
});
