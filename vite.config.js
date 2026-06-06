import { defineConfig } from 'vite';
import path from 'path';
import fs from 'fs';

// Plugin custom per copiare i decoder Draco nel dist
function copyDracoPlugin() {
  return {
    name: 'copy-draco',
    closeBundle() {
      const srcDir = path.resolve(__dirname, 'src/draco');
      const destDir = path.resolve(__dirname, 'dist/draco');
      if (fs.existsSync(srcDir)) {
        fs.mkdirSync(destDir, { recursive: true });
        for (const file of fs.readdirSync(srcDir)) {
          fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
        }
        console.log('[copy-draco] Decoder Draco copiati in dist/draco');
      }
    },
  };
}

export default defineConfig({
  root: 'src',
  base: './',
  plugins: [copyDracoPlugin()],
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, 'src/index.html'),
    },
  },
  resolve: {
    alias: {
      three: path.resolve(__dirname, 'node_modules/three'),
    },
  },
});
