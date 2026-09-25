/**
 * The icons the page and the manifest name are files that exist.
 *
 * The manifest listed icon-192.png and icon-512.png for months while neither
 * file was in web/public, so every install prompt and home-screen tile got a
 * 404. Browsers also ask the root for /favicon.ico and /apple-touch-icon.png
 * whatever the page declares.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Hono } from 'hono';
import { discoveryRoutes } from '../dist/server/routes/discovery.js';

function boardApp(): Hono {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set(
      'deps' as never,
      {
        config: { publicUrl: 'https://board.example', boardName: 'Test Board', isDirectory: false },
        pool: null,
        mailer: null,
        coinpay: null,
      } as never,
    );
    c.set('viewer' as never, null as never);
    await next();
  });
  app.route('/', discoveryRoutes() as unknown as Hono);
  return app;
}

const get = (path: string) => boardApp().request(`https://board.example${path}`);

test('every icon in the web app manifest is served with its declared type', async () => {
  const manifest = (await (await get('/manifest.webmanifest')).json()) as {
    icons: { src: string; type: string }[];
  };
  assert.ok(
    manifest.icons.some((i) => i.type === 'image/png'),
    'installers need a PNG',
  );
  for (const icon of manifest.icons) {
    const response = await get(icon.src);
    assert.equal(response.status, 200, icon.src);
    assert.equal(response.headers.get('content-type'), icon.type, icon.src);
  }
});

test('the root favicon and touch icon answer instead of 404ing', async () => {
  const ico = await get('/favicon.ico');
  assert.equal(ico.status, 200);
  assert.equal(ico.headers.get('content-type'), 'image/x-icon');
  const touch = await get('/apple-touch-icon.png');
  assert.equal(touch.status, 200);
  assert.equal(touch.headers.get('content-type'), 'image/png');
  const png = new Uint8Array(await touch.arrayBuffer());
  assert.deepEqual([...png.slice(1, 4)], [0x50, 0x4e, 0x47], 'a real PNG, not an error page');
});

test('the SVG favicon and the logo are served', async () => {
  for (const path of ['/assets/favicon.svg', '/assets/logo.svg', '/assets/icon.svg']) {
    const response = await get(path);
    assert.equal(response.status, 200, path);
    assert.match(await response.text(), /<svg[\s\S]*aria-label="agenticjobs"/, path);
  }
});
