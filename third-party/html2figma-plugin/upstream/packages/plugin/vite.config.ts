import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig(({ mode }) => {
  return {
    build: {
      target: 'es2017',
      rollupOptions: {
        input: resolve(__dirname, 'code.ts'),
        output: {
          format: 'iife' as const,
          name: 'FigmaPlugin',
          dir: 'dist',
          entryFileNames: 'code.js',
          inlineDynamicImports: true
        },
        external: []
      },
      sourcemap: false,
      minify: false,
      emptyOutDir: false
    },
    esbuild: {
      target: 'es2017'
    },
    resolve: {
      alias: {
        '@html2figma/shared': resolve(__dirname, '../shared'),
        '@html2figma/figma': resolve(__dirname, '../figma'),
        '@html2figma/adapter': resolve(__dirname, '../adapter/figma')
      }
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(mode)
    }
  };
});
