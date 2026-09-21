/**
 * /popular, /most-profitable, /skills, and the leaderboard package's own
 * routes (JSON, RSS, the widget) under /leaderboard.
 */

import { Hono } from 'hono';
import { leaderboard } from '@profullstack/leaderboard/hono';
import type { AppEnv } from '../deps.ts';
import { BOARDS, DEFAULT_PERIOD, isBoardId, isPeriod, topJobs } from '../../core/rankings.ts';
import { skillCounts } from '../../core/skills.ts';
import { Layout } from '../../views/layout.tsx';
import { RankingPage, SkillsPage } from '../../views/rankings.tsx';
import { shell } from './pages.tsx';

const PAY_NOTE =
  'Ranked by the annual figure a listing states in USD: the top of its range, or an hourly, daily, weekly or monthly rate annualised. A price per task or a revenue share has no annual figure and is not ranked.';

export function rankingRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  // The package's routes: /leaderboard.json, /leaderboard/<board>.json,
  // /leaderboard/<board>.xml, /leaderboard/u/<slug>, /leaderboard/embed.js.
  // Its full page and the embed page carry inline script, which this board's
  // CSP forbids, so those two are answered by the site's own pages instead.
  routes.get('/leaderboard', (c) => c.redirect('/popular', 302));
  routes.get('/leaderboard/embed', (c) => c.redirect('/popular', 302));
  routes.use('/leaderboard/*', async (c, next) => {
    const answer = await leaderboard(c.get('deps').rankings)(c, async () => {});
    if (answer instanceof Response) {
      answer.headers.set('cache-control', 'public, max-age=60');
      return answer;
    }
    await next();
  });
  routes.get('/leaderboard.json', async (c) => {
    const answer = await c.get('deps').rankings.handle(c.req.raw);
    return answer ?? c.notFound();
  });

  routes.get('/api/v1/rankings', async (c) => {
    const { rankings } = c.get('deps');
    const url = new URL(c.req.url);
    const period = isPeriod(url.searchParams.get('period'))
      ? (url.searchParams.get('period') as 'week')
      : DEFAULT_PERIOD;
    const limit = Math.min(
      100,
      Math.max(1, Number.parseInt(url.searchParams.get('limit') ?? '25', 10) || 25),
    );
    const wanted = url.searchParams.get('board');
    const ids = isBoardId(wanted) ? [wanted] : [...BOARDS];
    const boards = await Promise.all(ids.map((id) => topJobs(rankings, id, period, limit)));
    c.header('cache-control', 'public, max-age=60');
    return c.json({
      period,
      boards: boards.map((top) => ({
        id: top.board.id,
        label: top.board.label,
        unit: top.board.unit,
        total: top.total,
        rows: top.rows.map((row) => ({
          rank: row.rank,
          slug: row.id,
          name: row.name,
          value: row.value,
          display: row.display,
          url: row.url,
        })),
      })),
    });
  });

  routes.get('/popular', async (c) => {
    const { rankings, config } = c.get('deps');
    const url = new URL(c.req.url);
    const board = url.searchParams.get('board') === 'applied' ? 'applied' : 'popular';
    const period = isPeriod(url.searchParams.get('period'))
      ? (url.searchParams.get('period') as 'week')
      : DEFAULT_PERIOD;
    const top = await topJobs(rankings, board, period, 50);
    const title = board === 'applied' ? 'Most applied to' : 'Most read';
    return c.html(
      <Layout
        {...shell(c)}
        title={title}
        description={`The listings on ${config.boardName} getting the most attention.`}
        canonical={`${config.publicUrl}/popular${board === 'applied' ? '?board=applied' : ''}`}
      >
        <RankingPage
          board={board}
          top={top}
          title={title}
          intro={
            board === 'applied'
              ? 'The listings people and their agents applied to most.'
              : 'The listings read most, on the page and over the API.'
          }
        />
      </Layout>,
    );
  });

  routes.get('/most-profitable', async (c) => {
    const { rankings, config } = c.get('deps');
    const url = new URL(c.req.url);
    const period = isPeriod(url.searchParams.get('period'))
      ? (url.searchParams.get('period') as 'week')
      : DEFAULT_PERIOD;
    const top = await topJobs(rankings, 'profitable', period, 50);
    return c.html(
      <Layout
        {...shell(c)}
        title="Most profitable"
        description={`The best paid listings on ${config.boardName}.`}
        canonical={`${config.publicUrl}/most-profitable`}
      >
        <RankingPage
          board="profitable"
          top={top}
          title="Most profitable"
          intro="The listings that pay the most, by what they say they pay."
          note={PAY_NOTE}
        />
      </Layout>,
    );
  });

  routes.get('/skills', async (c) => {
    const { pool, config } = c.get('deps');
    const skills = await skillCounts(pool);
    return c.html(
      <Layout
        {...shell(c)}
        title="Skills"
        description={`Every skill on ${config.boardName}, with the listings and agents behind it.`}
        canonical={`${config.publicUrl}/skills`}
      >
        <SkillsPage skills={skills} />
      </Layout>,
    );
  });

  return routes;
}
