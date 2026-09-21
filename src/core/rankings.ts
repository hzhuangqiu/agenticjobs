/**
 * Rankings: which listings are being looked at, applied to, and paying most.
 *
 * Built on @profullstack/leaderboard over a projection of tables the board
 * already keeps, so the rankings cannot drift from the listings: a read is a
 * row in job_views, an application is a row in applications, and pay is the
 * listing's own stated annual figure. Nothing is written twice.
 *
 * Three boards, two sides. Reads and applications are usage; pay is money to
 * the person who takes the job, which the package calls the selling side.
 * They are never blended, because "most read" and "best paid" are different
 * facts and a listing can be both or neither.
 *
 * Pay ranks the listings that state an annual figure in USD. A price per
 * task has no annual figure and is not ranked, and the page says so.
 */

import {
  createLeaderboard,
  projectionStore,
  type Leaderboard,
  type Period,
  type Top,
} from '@profullstack/leaderboard';
import type pg from 'pg';
import type { Config } from '../config.ts';
import { annualPayCents } from './jobs.ts';

export const BOARDS = ['popular', 'applied', 'profitable'] as const;
export type BoardId = (typeof BOARDS)[number];
export const PERIODS: Period[] = ['week', 'month', 'all'];
export const DEFAULT_PERIOD: Period = 'month';

export function isBoardId(value: unknown): value is BoardId {
  return typeof value === 'string' && (BOARDS as readonly string[]).includes(value);
}

export function isPeriod(value: unknown): value is Period {
  return typeof value === 'string' && (PERIODS as readonly string[]).includes(value);
}

/** The path each board is published at, for links and the nav. */
export const BOARD_PATHS: Record<BoardId, string> = {
  popular: '/popular',
  applied: '/popular?board=applied',
  profitable: '/most-profitable',
};

export function createRankings(
  pool: pg.Pool,
  config: Pick<Config, 'boardName' | 'publicUrl'>,
): Leaderboard {
  const store = projectionStore({
    events: async () => {
      // The core asks for everything once and windows it in memory, so the
      // queries are bounded by rows, not by `since`. Only listings that are
      // live now are ranked: a closed listing at #1 is a link to a 404.
      const live = `j.status = 'published' and j.published_at is not null and j.published_at <= now()
                    and (j.expires_at is null or j.expires_at > now())`;
      const [views, applications] = await Promise.all([
        pool.query<{ slug: string; name: string; day: string; views: number }>(
          `select j.slug, j.title || ' at ' || o.name as name, v.day::text as day, v.views
             from job_views v join jobs j on j.id = v.job_id join organisations o on o.id = j.org_id
            where ${live} and v.views > 0 and v.day >= current_date - 400`,
        ),
        pool.query<{ slug: string; name: string; at: string }>(
          `select j.slug, j.title || ' at ' || o.name as name, coalesce(a.submitted_at, a.created_at) as at
             from applications a join jobs j on j.id = a.job_id join organisations o on o.id = j.org_id
            where ${live} and a.status <> 'draft'`,
        ),
      ]);
      return [
        ...views.rows.map((row) => ({
          player: row.slug,
          name: row.name,
          metric: 'views',
          delta: Number(row.views),
          // Noon on the day, so the window a day sits in does not depend on
          // which side of midnight the server clock is.
          at: Date.parse(`${row.day}T12:00:00Z`),
        })),
        ...applications.rows.map((row) => ({
          player: row.slug,
          name: row.name,
          metric: 'applications',
          delta: 1,
          at: Date.parse(row.at),
        })),
      ];
    },
    gauges: async () => {
      const rows = await annualPayCents(pool);
      const out: Record<string, { name: string; at: number; values: Record<string, number> }> = {};
      for (const row of rows) {
        out[row.slug] = {
          name: `${row.title} at ${row.org}`,
          at: Date.parse(row.publishedAt) || 0,
          values: { pay: row.cents },
        };
      }
      return out;
    },
  });

  return createLeaderboard({
    siteName: config.boardName,
    siteUrl: config.publicUrl,
    store,
    basePath: '/leaderboard',
    periods: PERIODS,
    defaultPeriod: DEFAULT_PERIOD,
    boards: {
      popular: {
        label: 'Most read',
        metric: 'views',
        format: 'integer',
        unit: 'Reads',
        tiebreak: 'applications',
        side: 'use',
        actor: 'Listing',
        min: 1,
      },
      applied: {
        label: 'Most applied to',
        metric: 'applications',
        format: 'integer',
        unit: 'Applications',
        tiebreak: 'views',
        side: 'use',
        actor: 'Listing',
        min: 1,
      },
      profitable: {
        label: 'Most profitable',
        metric: 'pay',
        format: 'usd',
        unit: 'A year',
        side: 'sell',
        actor: 'Listing',
        min: 1,
      },
    },
    sides: { use: 'Attention', sell: 'Pay' },
    badges: [],
    cacheMs: 60_000,
    limitMax: 100,
    profileUrl: (slug) => `/jobs/${encodeURIComponent(slug)}`,
  });
}

/** Count one read of a listing today. */
export async function recordView(pool: pg.Pool, jobId: string): Promise<void> {
  await pool.query(
    `insert into job_views (job_id, day, views) values ($1, current_date, 1)
     on conflict (job_id, day) do update set views = job_views.views + 1`,
    [jobId],
  );
}

export async function topJobs(
  rankings: Leaderboard,
  board: BoardId,
  period: Period = DEFAULT_PERIOD,
  limit = 25,
): Promise<Top> {
  return rankings.top({ board, period, limit });
}
