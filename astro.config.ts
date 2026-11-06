import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';
import type { Plugin } from 'vite';
import { createStaticHandler } from './server/static.ts';
import { getPaths } from './src/lib/config.ts';

const paths = getPaths();
const cacheDir = process.env.ASTRO_CACHE_DIR;

/** In `astro dev`, serve the resized images from the data folder like production does. */
function devImages(): Plugin {
  const handle = createStaticHandler({ siteDir: paths.siteDir, imgDir: paths.imgDir });
  return {
    name: 'portfolio-dev-images',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.startsWith('/_img/')) void handle(req, res);
        else next();
      });
    },
  };
}

export default defineConfig({
  site: process.env.SITE_URL ?? 'https://photo.mugetsu.xyz',
  output: 'static',
  trailingSlash: 'always',
  // Astro 7 defaults to JSX-style whitespace; keep normal HTML spacing instead.
  compressHTML: true,
  // Keep Astro's cache in the writable data folder when running in the container.
  cacheDir: cacheDir ?? './node_modules/.astro',
  prefetch: { prefetchAll: false, defaultStrategy: 'hover' },
  integrations: [react(), sitemap()],
  vite: {
    plugins: [devImages()],
    cacheDir: cacheDir ? `${cacheDir}/vite` : undefined,
  },
});
