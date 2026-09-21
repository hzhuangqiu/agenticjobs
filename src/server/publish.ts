/**
 * What happens around a listing going live, and being read.
 *
 * Both the API and the pages publish listings, and both read them, so the
 * side effects live here once: a published listing is matched against every
 * watch, and a read listing is counted for the rankings. Neither may fail
 * the request that caused it. A mail provider being down must not unpublish
 * a job, and a counter must never turn a job page into a 500.
 */

import type { Context } from 'hono';
import type { Job } from '../schema/job.ts';
import { notifyWatchers } from '../core/watches.ts';
import { pathForQuery } from '../core/landing.ts';
import { pushSubject, pushTo } from '../core/push.ts';
import { recordView } from '../core/rankings.ts';
import { forgetSkillCounts } from '../core/skills.ts';
import type { AppEnv } from './deps.ts';

export async function afterPublish(c: Context<AppEnv>, job: Job): Promise<void> {
  const { pool, mailer, config, rankings } = c.get('deps');
  // A new listing changes the tag counts and the boards; both are cached.
  forgetSkillCounts();
  rankings.invalidate();
  try {
    await notifyWatchers(pool, job, {
      mailer,
      boardName: config.boardName,
      publicUrl: config.publicUrl,
      slugPath: pathForQuery,
      push: async (userId, payload) => {
        await pushTo(pool, userId, payload, {
          subject: pushSubject(config.mailFrom, config.publicUrl),
        });
      },
    });
  } catch (error) {
    console.error(`watch notifications for ${job.slug} failed:`, error);
  }
}

export async function countView(c: Context<AppEnv>, job: Job): Promise<void> {
  const { pool } = c.get('deps');
  // Prefetches and HEAD checks are not reads.
  if (c.req.method !== 'GET') return;
  if ((c.req.header('purpose') ?? c.req.header('sec-purpose') ?? '').includes('prefetch')) return;
  try {
    await recordView(pool, job.id);
  } catch (error) {
    console.error(`view count for ${job.slug} failed:`, error);
  }
}
