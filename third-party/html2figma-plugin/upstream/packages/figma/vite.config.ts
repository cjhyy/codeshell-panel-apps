import { defineConfig, type UserConfig } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';

export default defineConfig(({ mode }): UserConfig => {
  return {
    plugins: [
      dts({
        insertTypesEntry: true,
        include: [
          'base/**/*',
          'creators/**/*',
          'factory/**/*',
          'utils/**/*',
          'index.ts',
          'FigmaService.ts',
          'creator.ts',
          'types.ts',
          'types-api.ts'
        ],
        exclude: ['vite.config.ts'],
        outDir: 'dist',
        copyDtsFiles: true,
        strictOutput: false
      })
    ],
    build: {
      lib: {
        entry: resolve(__dirname, 'index.ts'),
        name: 'Html2FigmaPlugin',
        fileName: (format) => `index.${format === 'es' ? 'js' : 'cjs'}`,
        formats: ['es', 'cjs']
      },
      outDir: 'dist',
      rollupOptions: {
        external: ['figma'],
        output: {
          globals: {
            figma: 'figma'
          }
        }
      },
      sourcemap: true,
      minify: false
    },
    resolve: {
      alias: {
        '@html2figma/shared': resolve(__dirname, '../shared'),
        '@html2figma/adapter': resolve(__dirname, '../adapter/figma')
      }
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(mode)
    }
  };
});
