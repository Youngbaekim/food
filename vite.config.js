import { defineConfig } from 'vite';

// GitHub Pages 주소: https://youngbaekim.github.io/food/
export default defineConfig({
  base: '/food/',
  define: { __APP_VERSION__: JSON.stringify(process.env.npm_package_version || '0.1.0') },
  build: { chunkSizeWarningLimit: 1500 },
});
