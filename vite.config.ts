import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'three-core', test: id => id.replaceAll('\\', '/').endsWith('/three/build/three.core.js') },
            { name: 'three-webgl', test: id => id.replaceAll('\\', '/').endsWith('/three/build/three.module.js') },
          ],
        },
      },
    },
  },
})
