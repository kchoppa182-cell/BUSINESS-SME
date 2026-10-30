import { env } from 'cloudflare:workers';
import { httpServerHandler } from 'cloudflare:node';
import { createRequire } from 'node:module';

// Pass Cloudflare bindings into the existing Express application without
// exposing server-only credentials to browser assets.
globalThis.__BSI_CONFIG__ = {
  CLOUDFLARE_WORKERS: true,
  SUPABASE_URL: env.SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY: env.SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
};

const require = createRequire(import.meta.url);
const app = require('./backend/server.js');

app.listen(3000);
const expressWorker = httpServerHandler({ port: 3000 });

export default {
  async fetch(request, workerEnv, executionContext) {
    const url = new URL(request.url);
    if (url.pathname === '/') {
      return workerEnv.ASSETS.fetch(new Request(new URL('/home.html', request.url), request));
    }
    return expressWorker.fetch(request, workerEnv, executionContext);
  },
};
