import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Eigen service worker (src/sw.ts): offline gebruiken én meldingen in één bestand.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      // gewoon script (geen module): werkt in alle browsers, ook oudere Safari
      injectManifest: { globPatterns: ['**/*.{js,css,html,svg,woff2}'], rollupFormat: 'iife' },
      manifest: {
        name: 'Work-OS',
        short_name: 'Work-OS',
        description: 'Work-OS: taken, mail en antwoorden op één plek',
        lang: 'nl',
        start_url: '/',
        display: 'standalone',
        background_color: '#FBFAF7',
        theme_color: '#FBFAF7',
        icons: [
          { src: 'icons/icon-192.svg', sizes: '192x192', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icons/icon-512.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
