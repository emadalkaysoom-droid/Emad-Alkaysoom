import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { createServer as createViteServer } from 'vite';
import { getDb } from './server/db/schema.ts';
import { discoverAndSyncPlugins } from './server/plugins/pluginManager.ts';
import { createApiRouter } from './server/routes/api.ts';

async function startServer() {
  // Initialize SQLite relational database & run migrations
  getDb();
  discoverAndSyncPlugins();

  const app = express();
  app.use(express.json({ limit: '12mb' }));
  app.use(express.urlencoded({ extended: true, limit: '12mb' }));

  // Mount OMNIX API routes
  app.use('/api', createApiRouter());

  const isProd = process.env.NODE_ENV === 'production';
  const distPath = path.resolve(process.cwd(), 'dist');

  if (!isProd || !fs.existsSync(distPath)) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const port = Number(process.env.PORT || 3000);
  app.listen(port, '0.0.0.0', () => {
    console.log(`OMNIX Platform server listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start OMNIX server:', err);
  process.exit(1);
});
