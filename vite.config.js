import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// `npm run dev:https` serves over https so phones on your Wi-Fi can use GPS
// (browsers block location on plain http, except localhost).
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'https' ? [basicSsl()] : [],
  build: { outDir: 'dist', chunkSizeWarningLimit: 1500 },
}));
