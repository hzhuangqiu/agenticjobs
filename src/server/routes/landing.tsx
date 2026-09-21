/**
 * Landing pages: `/rust/remote` and every other search that is a path.
 *
 * Mounted last. Anything an earlier router answers is not a landing page,
 * so a tag can never shadow a real route; a path that is not a well-formed
 * search, or names a tag the board has never seen, falls through to the 404
 * the site already has.
 */

import { Hono } from 'hono';
import type { AppEnv } from '../deps.ts';
import { pathForQuery, queryFromPath, titleForQuery } from '../../core/landing.ts';
import { searchJobs } from '../../core/jobs.ts';
import { skillCounts } from '../../core/skills.ts';
import { parseQuery } from '../../schema/query.ts';
import { Layout } from '../../views/layout.tsx';
import { JobList } from '../../views/jobs.tsx';
import { shell } from './pages.tsx';

export function landingRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.get('/*', async (c, next) => {
    const url = new URL(c.req.url);
    const fromPath = queryFromPath(url.pathname);
    if (fromPath === null) {
      await next();
      return;
    }
    // Paging and sort still come from the querystring; the path is the
    // search. Anything else on the querystring is ignored, so the page is
    // the one its path says it is.
    const extras = parseQuery(url.searchParams);
    const query = { ...fromPath, sort: extras.sort, limit: extras.limit, offset: extras.offset };
    const canonicalPath = pathForQuery(query);
    if (canonicalPath === null) {
      await next();
      return;
    }
    if (canonicalPath !== url.pathname) {
      // One page per search: `/remote/rust` is `/rust/remote`.
      const search = url.search;
      return c.redirect(`${canonicalPath}${search}`, 301);
    }

    const { pool, config } = c.get('deps');
    // A tag is a page only when the board has it. Otherwise every typo in the
    // address bar would be a 200 with an empty list, and the 404 page would
    // never be seen again. Filter-only paths (/remote, /120k+) always exist.
    if (query.tags.length > 0) {
      const known = new Set((await skillCounts(pool)).map((row) => row.skill));
      if (query.tags.some((tag) => !known.has(tag))) {
        await next();
        return;
      }
    }
    const page = await searchJobs(pool, query);
    const title = titleForQuery(query);
    return c.html(
      <Layout
        {...shell(c)}
        title={title}
        description={`${title} on ${config.boardName}: ${page.total} open now, every one posted here by the employer. Watch this search to hear about new ones.`}
        canonical={`${config.publicUrl}${canonicalPath}`}
      >
        <JobList
          page={page}
          query={query}
          boardName={config.boardName}
          tagline={config.boardTagline}
          publicUrl={config.publicUrl}
          heading={title}
          intro={`${page.total === 0 ? 'None open right now' : page.total === 1 ? 'One open now' : `${page.total} open now`}, every one posted here by the employer. Other boards on the network: ${config.isDirectory ? '/network' : 'agenticjobs search --network'}.`}
          base={canonicalPath}
          signedIn={c.get('viewer') !== null}
        />
      </Layout>,
    );
  });

  return routes;
}
