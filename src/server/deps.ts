import type pg from 'pg';
import type { Config } from '../config.ts';
import type { Viewer } from '../core/auth.ts';
import type { Mailer } from '../core/mail.ts';
import type { CoinPayClient } from '../core/coinpay.ts';
import type { Leaderboard } from '@profullstack/leaderboard';
import type { SkillCount } from '../core/skills.ts';

export interface Deps {
  pool: pg.Pool;
  config: Config;
  /** Null when this instance sends no mail, which is a supported state. */
  mailer: Mailer | null;
  /** Null when billing is not configured, which is also a supported state. */
  coinpay: CoinPayClient | null;
  /** The rankings, projected over the listings. */
  rankings: Leaderboard;
}

/**
 * Hono's per-request bag.
 *
 * `viewer` is resolved once by middleware and read everywhere else. Resolving
 * it per handler is how a page ends up doing four session lookups, and how one
 * handler forgets to and renders a signed-in person as a stranger.
 */
export interface AppEnv {
  Variables: {
    viewer: Viewer | null;
    deps: Deps;
    /** Conversations with something unread, for the nav. Pages only. */
    unread: number;
    /** Notifications not yet read, for the nav. Pages only. */
    alerts: number;
    /** The skills the footer links to. Pages only. */
    skills: SkillCount[];
  };
}
