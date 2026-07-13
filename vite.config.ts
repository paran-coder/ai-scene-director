import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/react/') || id.includes('/node_modules/react-dom/') || id.includes('/node_modules/scheduler/') || id.includes('/node_modules/zustand/')) return 'react-vendor';
          if (id.includes('/node_modules/three/')) return 'three-core';
          if (id.includes('/node_modules/@react-three/')) return 'react-three';
          return undefined;
        },
      },
    },
  },
});
