import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Hono } from 'hono';
import { apiRoutes } from '../dist/server/routes/api.js';

test('the authenticated own-jobs endpoint includes drafts for the TUI listings tab', async () => {
  let sqlSeen = '';
  const pool = {
    query: async (sql: string) => {
      sqlSeen = sql;
      return { rows: [draftJobRow] };
    },
  };
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set(
      'deps' as never,
      { pool, config: {}, mailer: null, coinpay: null, rankings: null } as never,
    );
    c.set(
      'viewer' as never,
      {
        id: 'owner-id',
        email: 'owner@example.test',
        name: 'Owner',
        isAdmin: false,
        viaToken: true,
      } as never,
    );
    await next();
  });
  app.route('/api/v1', apiRoutes() as never);

  const response = await app.request('/api/v1/me/jobs');
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const result = (await response.json()) as { items: { slug: string; status: string }[] };
  assert.deepEqual(
    result.items.map((job) => [job.slug, job.status]),
    [['draft-role', 'draft']],
  );
  assert.match(sqlSeen, /join memberships/);
  assert.doesNotMatch(sqlSeen, /j\.status\s*=\s*'published'/);
});

const draftJobRow = {
  id: '00000000-0000-4000-8000-000000000001',
  slug: 'draft-role',
  title: 'Draft Role',
  description: 'A draft listing.',
  employment_type: 'full-time',
  workplace: 'remote',
  seniority: null,
  location: null,
  remote_regions: [],
  salary_min: null,
  salary_max: null,
  salary_currency: 'USD',
  salary_period: 'year',
  salary_equity: null,
  salary_unpaid: false,
  pay_lines: [],
  pay_method: null,
  tags: [],
  stack: [],
  requirements: [],
  responsibilities: [],
  agent_policy: 'disclose',
  apply_via: 'board',
  apply_url: null,
  apply_source_url: null,
  apply_email: null,
  apply_schema: { fields: [] },
  status: 'draft',
  published_at: null,
  expires_at: null,
  created_at: '2026-09-24T00:00:00.000Z',
  updated_at: '2026-09-24T00:00:00.000Z',
  org_id: '00000000-0000-4000-8000-000000000002',
  org_slug: 'example-works',
  org_name: 'Example Works',
  org_website: null,
  org_logo_url: null,
  org_description: null,
  org_created_at: '2026-09-01T00:00:00.000Z',
};
