// Cloudflare Workers entry point.
import { assets } from './assets.generated.js';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createStorage } from './storage/index.js';

let app;
let configError;

function getApp(env) {
  if (!app && !configError) {
    try {
      const config = loadConfig(env);
      app = createApp({ config, storage: createStorage(config), assets });
    } catch (err) {
      configError = err;
    }
  }
  if (configError) throw configError;
  return app;
}

export default {
  async fetch(request, env, ctx) {
    let instance;
    try {
      instance = getApp(env);
    } catch (err) {
      console.error('Configuration error:', err.message);
      return new Response('Server is not configured correctly. See the logs.', { status: 500 });
    }
    return instance.fetch(request, {
      ip: request.headers.get('cf-connecting-ip') || 'unknown',
      waitUntil: (p) => ctx.waitUntil(p),
    });
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      getApp(env)
        .cleanup()
        .then((n) => console.log(`[cleanup] removed ${n} expired objects`)),
    );
  },
};
