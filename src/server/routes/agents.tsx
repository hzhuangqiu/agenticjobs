/**
 * Agents: the API, the directory and the account pages.
 *
 * Mounted before the API router, whose catch-all answers 404 for anything
 * under /api/v1 it does not know.
 */

import { Hono, type Context } from 'hono';
import type { AppEnv } from '../deps.ts';
import {
  agentSkillCounts,
  AgentProblem,
  assignOperator,
  deleteAgent,
  getAgent,
  listAgents,
  listPublicAgents,
  registerAgent,
  updateAgent,
} from '../../core/agents.ts';
import { forgetSkillCounts } from '../../core/skills.ts';
import { renderMarkdown } from '../../markup/markdown.ts';
import { Layout } from '../../views/layout.tsx';
import { AgentDirectory, AgentForm, AgentPage } from '../../views/agents.tsx';
import { formOf, requireViewer, shell } from './pages.tsx';

type Ctx = Context<AppEnv>;

function problem(c: Ctx, error: AgentProblem): Response {
  return c.json(
    {
      error: {
        code: error.status === 404 ? 'not_found' : 'invalid',
        message: error.message,
        ...(error.field === undefined
          ? {}
          : { fields: [{ field: error.field, message: error.message }] }),
      },
    },
    error.status,
  );
}

const api =
  (fn: (c: Ctx) => Promise<Response>) =>
  async (c: Ctx): Promise<Response> => {
    try {
      return await fn(c);
    } catch (error) {
      if (error instanceof AgentProblem) return problem(c, error);
      throw error;
    }
  };

function signedIn(c: Ctx): { id: string } | Response {
  const viewer = c.get('viewer');
  if (viewer === null) {
    return c.json({ error: { code: 'unauthenticated', message: 'Sign in first.' } }, 401);
  }
  return viewer;
}

async function body(c: Ctx): Promise<Record<string, unknown>> {
  const type = c.req.header('content-type') ?? '';
  try {
    if (type.includes('application/json')) {
      const parsed = (await c.req.json()) as unknown;
      return typeof parsed === 'object' && parsed !== null
        ? (parsed as Record<string, unknown>)
        : {};
    }
    return (await c.req.parseBody()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function skillsList(input: unknown): string[] {
  return Array.isArray(input)
    ? input.map(String)
    : typeof input === 'string'
      ? input.split(',')
      : [];
}

export function agentRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  // --- API ------------------------------------------------------------------

  routes.get(
    '/api/v1/agents',
    api(async (c) => {
      const { pool } = c.get('deps');
      const url = new URL(c.req.url);
      const skill = url.searchParams.get('skill');
      const limit = Number.parseInt(url.searchParams.get('limit') ?? '100', 10) || 100;
      const items = await listPublicAgents(pool, { skill, limit });
      return c.json({ items, total: items.length });
    }),
  );

  routes.get(
    '/api/v1/agents/skills',
    api(async (c) => c.json({ items: await agentSkillCounts(c.get('deps').pool) })),
  );

  routes.get(
    '/api/v1/me/agents',
    api(async (c) => {
      const viewer = signedIn(c);
      if (viewer instanceof Response) return viewer;
      c.header('cache-control', 'private, no-store');
      const items = await listAgents(c.get('deps').pool, viewer.id);
      return c.json({ items, total: items.length });
    }),
  );

  routes.post(
    '/api/v1/agents',
    api(async (c) => {
      const viewer = signedIn(c);
      if (viewer instanceof Response) return viewer;
      const agent = await registerAgent(c.get('deps').pool, viewer.id, await body(c));
      forgetSkillCounts();
      return c.json({ agent, url: `${c.get('deps').config.publicUrl}/agents/${agent.slug}` }, 201);
    }),
  );

  routes.get(
    '/api/v1/agents/:slug',
    api(async (c) => {
      const agent = await getAgent(
        c.get('deps').pool,
        c.req.param('slug') ?? '',
        c.get('viewer')?.id ?? null,
      );
      if (agent === null)
        return c.json({ error: { code: 'not_found', message: 'No such agent.' } }, 404);
      return c.json({ agent });
    }),
  );

  routes.patch(
    '/api/v1/agents/:slug',
    api(async (c) => {
      const viewer = signedIn(c);
      if (viewer instanceof Response) return viewer;
      const agent = await updateAgent(
        c.get('deps').pool,
        viewer.id,
        c.req.param('slug') ?? '',
        await body(c),
      );
      forgetSkillCounts();
      return c.json({ agent });
    }),
  );

  /** Name this agent as the operator of others: `{ "agents": ["a", "b"] }`. */
  routes.post(
    '/api/v1/agents/:slug/operates',
    api(async (c) => {
      const viewer = signedIn(c);
      if (viewer instanceof Response) return viewer;
      const input = await body(c);
      const slugs = skillsList(input['agents'])
        .map((s) => s.trim())
        .filter((s) => s !== '');
      if (slugs.length === 0) {
        throw new AgentProblem(
          'Say which agents this one operates: agents: ["a", "b"].',
          400,
          'agents',
        );
      }
      const agent = await assignOperator(
        c.get('deps').pool,
        viewer.id,
        c.req.param('slug') ?? '',
        slugs,
      );
      return c.json({ agent });
    }),
  );

  routes.delete(
    '/api/v1/agents/:slug',
    api(async (c) => {
      const viewer = signedIn(c);
      if (viewer instanceof Response) return viewer;
      await deleteAgent(c.get('deps').pool, viewer.id, c.req.param('slug') ?? '');
      forgetSkillCounts();
      return c.json({ deleted: true });
    }),
  );

  // --- pages ----------------------------------------------------------------

  routes.get('/agents', async (c) => {
    const { pool } = c.get('deps');
    const skill = new URL(c.req.url).searchParams.get('skill');
    const [agents, skills] = await Promise.all([
      listPublicAgents(pool, { skill }),
      agentSkillCounts(pool, 60),
    ]);
    return c.html(
      <Layout
        {...shell(c)}
        title={skill === null ? 'Agents' : `Agents with ${skill}`}
        description="Agents registered by the people who operate them, with what each is good at."
      >
        <AgentDirectory agents={agents} skill={skill} skills={skills} />
      </Layout>,
    );
  });

  routes.get('/agents/:slug', async (c) => {
    const { pool } = c.get('deps');
    const viewer = c.get('viewer');
    const agent = await getAgent(pool, c.req.param('slug'), viewer?.id ?? null);
    if (agent === null) return c.notFound();
    const mine =
      viewer !== null && (await listAgents(pool, viewer.id)).some((a) => a.id === agent.id);
    return c.html(
      <Layout
        {...shell(c)}
        title={agent.name}
        description={`${agent.name}: ${agent.skills.join(', ')}.`}
        noindex={!agent.public}
      >
        <AgentPage
          agent={agent}
          html={
            agent.description === '' ? '' : renderMarkdown(agent.description, { headingOffset: 2 })
          }
          mine={mine}
        />
      </Layout>,
    );
  });

  routes.get('/me/agents/new', async (c) => {
    const viewer = requireViewer(c);
    if (viewer instanceof Response) return viewer;
    const agents = await listAgents(c.get('deps').pool, viewer.id);
    return c.html(
      <Layout {...shell(c)} title="Register an agent" noindex>
        <AgentForm agents={agents} values={{}} />
      </Layout>,
    );
  });

  routes.post('/me/agents/new', async (c) => {
    const viewer = requireViewer(c);
    if (viewer instanceof Response) return viewer;
    const { pool } = c.get('deps');
    const form = await formOf(c);
    try {
      const agent = await registerAgent(pool, viewer.id, {
        name: form['name'],
        skills: form['skills'],
        description: form['description'],
        url: form['url'],
        operator: form['operator'],
        public: form['public'] === 'on',
      });
      forgetSkillCounts();
      return c.redirect(`/agents/${agent.slug}`, 303);
    } catch (error) {
      if (!(error instanceof AgentProblem)) throw error;
      const agents = await listAgents(pool, viewer.id);
      return c.html(
        <Layout {...shell(c)} title="Register an agent" noindex>
          <AgentForm
            agents={agents}
            values={{ ...form, public: form['public'] === 'on' ? 'on' : 'off' }}
            error={error.message}
          />
        </Layout>,
        400,
      );
    }
  });

  routes.post('/me/agents/:slug/delete', async (c) => {
    const viewer = requireViewer(c);
    if (viewer instanceof Response) return viewer;
    try {
      await deleteAgent(c.get('deps').pool, viewer.id, c.req.param('slug') ?? '');
      forgetSkillCounts();
    } catch (error) {
      if (!(error instanceof AgentProblem)) throw error;
    }
    return c.redirect('/me#agents', 303);
  });

  return routes;
}
