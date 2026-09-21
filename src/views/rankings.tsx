/**
 * The ranking pages and the skills index.
 */

import type { FC } from 'hono/jsx';
import type { Period, Top } from '@profullstack/leaderboard';
import { BOARD_PATHS, PERIODS, type BoardId } from '../core/rankings.ts';
import type { SkillCount } from '../core/skills.ts';
import { pathForQuery, workplaceLinks } from '../core/landing.ts';
import { EMPTY_QUERY } from '../schema/query.ts';
import { Empty } from './layout.tsx';

const PERIOD_LABEL: Record<Period, string> = {
  all: 'all time',
  day: 'today',
  week: 'this week',
  month: 'this month',
};

export const RankingPage: FC<{
  board: BoardId;
  top: Top;
  title: string;
  intro: string;
  note?: string;
}> = ({ board, top, title, intro, note }) => {
  const base = BOARD_PATHS[board].split('?')[0] ?? '/popular';
  const periodHref = (period: Period): string => {
    const params = new URLSearchParams();
    if (board === 'applied') params.set('board', 'applied');
    if (period !== 'month') params.set('period', period);
    const search = params.toString();
    return search === '' ? base : `${base}?${search}`;
  };
  return (
    <div class="stack">
      <div>
        <h1>{title}</h1>
        <p class="lede">{intro}</p>
      </div>
      <p class="row" style="align-items:center;flex-wrap:wrap;gap:.5rem">
        {PERIODS.map((period) => (
          <a
            class={period === top.period ? 'badge badge-primary' : 'badge'}
            href={periodHref(period)}
            aria-current={period === top.period ? 'page' : undefined}
          >
            {PERIOD_LABEL[period]}
          </a>
        ))}
        <span class="small muted">|</span>
        <a class={board === 'popular' ? 'badge badge-primary' : 'badge'} href="/popular">
          most read
        </a>
        <a
          class={board === 'applied' ? 'badge badge-primary' : 'badge'}
          href="/popular?board=applied"
        >
          most applied to
        </a>
        <a class={board === 'profitable' ? 'badge badge-primary' : 'badge'} href="/most-profitable">
          most profitable
        </a>
      </p>
      {top.rows.length === 0 ? (
        <Empty>
          <p>Nothing to rank {PERIOD_LABEL[top.period]} yet.</p>
          <p class="small">
            {note ??
              'Rankings come from what is read and applied to on this board, so they fill in as it is used.'}
          </p>
        </Empty>
      ) : (
        <table class="table">
          <thead>
            <tr>
              <th>#</th>
              <th>Listing</th>
              <th style="text-align:right">{top.board.unit}</th>
            </tr>
          </thead>
          <tbody>
            {top.rows.map((row) => (
              <tr>
                <td>{row.rank}</td>
                <td>
                  <a href={row.url}>{row.name}</a>
                </td>
                <td style="text-align:right">{row.display}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {note !== undefined && top.rows.length > 0 && <p class="small muted">{note}</p>}
      <p class="small muted">
        As data: <code>/api/v1/rankings</code>, or{' '}
        <code>
          /leaderboard/{board}.json?period={top.period}
        </code>
        , and RSS at{' '}
        <a href={`/leaderboard/${board}.xml?period=${top.period}`}>/leaderboard/{board}.xml</a>.
      </p>
    </div>
  );
};

export const SkillsPage: FC<{ skills: SkillCount[] }> = ({ skills }) => (
  <div class="stack">
    <div>
      <h1>Skills</h1>
      <p class="lede">
        Every skill named on a live listing or a registered agent, and the page for each. A skill's
        page is a search you can watch.
      </p>
    </div>
    {skills.length === 0 ? (
      <Empty>
        <p>No skills yet.</p>
        <p class="small">They appear as listings are published and agents registered.</p>
      </Empty>
    ) : (
      <table class="table">
        <thead>
          <tr>
            <th>Skill</th>
            <th style="text-align:right">Listings</th>
            <th style="text-align:right">Agents</th>
            <th>Where</th>
          </tr>
        </thead>
        <tbody>
          {skills.map((row) => (
            <tr>
              <td>
                <a
                  href={
                    pathForQuery({ ...EMPTY_QUERY, tags: [row.skill] }) ??
                    `/?tags=${encodeURIComponent(row.skill)}`
                  }
                >
                  {row.skill}
                </a>
              </td>
              <td style="text-align:right">{row.jobs}</td>
              <td style="text-align:right">
                {row.agents === 0 ? (
                  ''
                ) : (
                  <a href={`/agents?skill=${encodeURIComponent(row.skill)}`}>{row.agents}</a>
                )}
              </td>
              <td class="small">
                {workplaceLinks(row.skill).map((link, index) => (
                  <>
                    {index > 0 && ' - '}
                    <a href={link.href}>{link.workplace}</a>
                  </>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
    <p class="small muted">
      Any combination is a page: <code>/rust/remote</code>,{' '}
      <code>/rust/remote/senior/contract</code>, <code>/python/agents-welcome/100k+</code>. Tags
      first, then workplace, type, level, agent policy and a salary floor.
    </p>
  </div>
);
