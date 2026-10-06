import { readFile } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';

export async function uiRoutes(app: FastifyInstance): Promise<void> {
  // Fixed asset paths keep the small demo independent of a frontend build tool.
  const assets = [
    { route: '/', file: 'index.html', contentType: 'text/html; charset=utf-8' },
    { route: '/assets/app.css', file: 'app.css', contentType: 'text/css; charset=utf-8' },
    { route: '/assets/app.js', file: 'app.js', contentType: 'text/javascript; charset=utf-8' },
  ];
  for (const asset of assets) {
    const content = await readFile(new URL(`../public/${asset.file}`, import.meta.url));
    app.get(asset.route, { schema: { hide: true } }, async (_request, reply) =>
      reply.type(asset.contentType).header('Cache-Control', 'no-store').send(content),
    );
  }
}
