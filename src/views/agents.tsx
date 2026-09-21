/**
 * Agents: the card on your account page, the form that registers one, the
 * public directory and one agent's page.
 */

import type { FC } from 'hono/jsx';
import type { Agent } from '../core/agents.ts';
import { ago } from '../schema/text.ts';
import { pathForQuery } from '../core/landing.ts';
import { EMPTY_QUERY } from '../schema/query.ts';
import { Alert, Badge, Card, Empty, Field, Prose } from './layout.tsx';

function skillHref(skill: string): string {
  return `/agents?skill=${encodeURIComponent(skill)}`;
}

export const AgentsCard: FC<{ agents: Agent[] }> = ({ agents }) => (
  <Card>
    <div class="card-header">
      <h2 class="card-title" id="agents">
        Your agents
      </h2>
      <p class="card-description">
        The agents you operate, and what each is good at. An agent can name another of yours as its
        operator, so a swarm is written down as a tree. From a terminal:{' '}
        <code>agenticjobs agents register "Reviewer" --skills "rust, code review"</code>.
      </p>
    </div>
    {agents.length === 0 ? (
      <p class="small muted">None registered yet.</p>
    ) : (
      <ul class="stack" style="gap:.5rem">
        {agents.map((agent) => (
          <li>
            <a href={`/agents/${agent.slug}`}>
              <strong>{agent.name}</strong>
            </a>{' '}
            <span class="small muted">
              {agent.skills.join(', ')}
              {agent.operator !== null && <> - operated by {agent.operator.name}</>}
              {agent.operates.length > 0 && (
                <> - operates {agent.operates.map((a) => a.name).join(', ')}</>
              )}
              {!agent.public && ' - private'}
            </span>{' '}
            <form method="post" action={`/me/agents/${agent.slug}/delete`} style="display:inline">
              <button class="btn btn-ghost btn-sm" type="submit">
                Remove
              </button>
            </form>
          </li>
        ))}
      </ul>
    )}
    <p style="margin-top:.75rem">
      <a class="btn btn-secondary btn-sm" href="/me/agents/new">
        Register an agent
      </a>
    </p>
  </Card>
);

export const AgentForm: FC<{
  agents: Agent[];
  values: Record<string, string>;
  error?: string;
}> = ({ agents, values, error }) => (
  <div class="stack">
    <div>
      <h1>Register an agent</h1>
      <p class="lede">
        You are its operator: the person answerable for what it does here. Skills are required, so
        it can be matched to listings.
      </p>
    </div>
    {error !== undefined && <Alert variant="error">{error}</Alert>}
    <form method="post" action="/me/agents/new" class="stack">
      <Field label="Name" name="name">
        <input
          class="input"
          id="name"
          name="name"
          required
          maxlength={80}
          value={values['name'] ?? ''}
        />
      </Field>
      <Field label="Skills, comma separated (required)" name="skills">
        <input
          class="input"
          id="skills"
          name="skills"
          required
          placeholder="rust, code review, pull requests"
          value={values['skills'] ?? ''}
        />
      </Field>
      <Field label="What it does (Markdown, optional)" name="description">
        <textarea class="textarea" id="description" name="description" rows={5}>
          {values['description'] ?? ''}
        </textarea>
      </Field>
      <Field label="Where it lives (URL, optional)" name="url">
        <input class="input" id="url" name="url" type="url" value={values['url'] ?? ''} />
      </Field>
      {agents.length > 0 && (
        <Field label="Operated by (one of your agents, optional)" name="operator">
          <select class="select" id="operator" name="operator">
            <option value="">You, directly</option>
            {agents.map((agent) => (
              <option value={agent.slug} selected={values['operator'] === agent.slug}>
                {agent.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <label class="small">
        <input type="checkbox" name="public" value="on" checked={values['public'] !== 'off'} /> List
        it in the public agent directory
      </label>
      <div class="row">
        <button class="btn" type="submit">
          Register
        </button>
        <a class="btn btn-ghost" href="/me#agents">
          Cancel
        </a>
      </div>
    </form>
  </div>
);

export const AgentDirectory: FC<{
  agents: Agent[];
  skill: string | null;
  skills: { skill: string; count: number }[];
}> = ({ agents, skill, skills }) => (
  <div class="stack">
    <div>
      <h1>Agents</h1>
      <p class="lede">
        Agents registered here by the people who operate them, with what each is good at.
        {skill !== null && (
          <>
            {' '}
            Showing those with <Badge>{skill}</Badge>. <a href="/agents">All agents</a>
          </>
        )}
      </p>
    </div>
    {skills.length > 0 && (
      <p class="row" style="flex-wrap:wrap;gap:.5rem">
        <span class="small muted">Skills:</span>
        {skills.slice(0, 30).map((item) => (
          <a class="badge" href={skillHref(item.skill)}>
            {item.skill} {item.count}
          </a>
        ))}
      </p>
    )}
    {agents.length === 0 ? (
      <Empty>
        <p>No agents listed yet.</p>
        <p class="small">
          Register yours from your <a href="/me#agents">account page</a> or with{' '}
          <code>agenticjobs agents register</code>.
        </p>
      </Empty>
    ) : (
      <ul class="job-list">
        {agents.map((agent) => (
          <li class="job-card">
            <div class="stack" style="gap:.25rem">
              <a href={`/agents/${agent.slug}`}>
                <strong>{agent.name}</strong>
              </a>
              <div class="row" style="flex-wrap:wrap;gap:.35rem">
                {agent.skills.map((item) => (
                  <a class="badge" href={skillHref(item)}>
                    {item}
                  </a>
                ))}
              </div>
              <div class="small muted">
                {agent.owner.candidateSlug !== null ? (
                  <>
                    operated by{' '}
                    <a href={`/candidates/${agent.owner.candidateSlug}`}>
                      {agent.owner.name ?? 'a member'}
                    </a>
                  </>
                ) : (
                  <>operated by {agent.owner.name ?? 'a member'}</>
                )}
                {agent.operator !== null && (
                  <>
                    {' '}
                    through <a href={`/agents/${agent.operator.slug}`}>{agent.operator.name}</a>
                  </>
                )}
                {' - '}
                {ago(agent.createdAt)}
              </div>
            </div>
          </li>
        ))}
      </ul>
    )}
    <p class="small muted">
      As data: <code>/api/v1/agents</code>, and <code>/api/v1/agents?skill=rust</code>.
    </p>
  </div>
);

export const AgentPage: FC<{ agent: Agent; html: string; mine: boolean }> = ({
  agent,
  html,
  mine,
}) => (
  <div class="stack">
    <div>
      <h1>{agent.name}</h1>
      <p class="lede">
        An agent
        {agent.owner.candidateSlug !== null ? (
          <>
            {' '}
            operated by{' '}
            <a href={`/candidates/${agent.owner.candidateSlug}`}>
              {agent.owner.name ?? 'a member'}
            </a>
          </>
        ) : (
          <> operated by {agent.owner.name ?? 'a member of this board'}</>
        )}
        {agent.operator !== null && (
          <>
            , through <a href={`/agents/${agent.operator.slug}`}>{agent.operator.name}</a>
          </>
        )}
        .{!agent.public && ' Private: only you can see this page.'}
      </p>
    </div>
    <Card>
      <div class="card-header">
        <h2 class="card-title">Skills</h2>
      </div>
      <div class="row" style="flex-wrap:wrap;gap:.35rem">
        {agent.skills.map((item) => (
          <a class="badge" href={skillHref(item)}>
            {item}
          </a>
        ))}
      </div>
      <p class="small muted" style="margin-top:.75rem">
        Listings asking for these:{' '}
        {agent.skills.slice(0, 5).map((item, index) => (
          <>
            {index > 0 && ', '}
            <a
              href={
                pathForQuery({ ...EMPTY_QUERY, tags: [item] }) ??
                `/?tags=${encodeURIComponent(item)}`
              }
            >
              {item}
            </a>
          </>
        ))}
      </p>
    </Card>
    {html !== '' && (
      <Card>
        <div class="card-header">
          <h2 class="card-title">What it does</h2>
        </div>
        <Prose html={html} />
      </Card>
    )}
    {agent.operates.length > 0 && (
      <Card>
        <div class="card-header">
          <h2 class="card-title">Operates</h2>
          <p class="card-description">Agents that answer to this one.</p>
        </div>
        <ul>
          {agent.operates.map((item) => (
            <li>
              <a href={`/agents/${item.slug}`}>{item.name}</a>
            </li>
          ))}
        </ul>
      </Card>
    )}
    {agent.url !== null && (
      <p class="small">
        Lives at{' '}
        <a href={agent.url} rel="nofollow noopener">
          {agent.url}
        </a>
      </p>
    )}
    {mine && (
      <p class="small muted">
        Yours. Change it with <code>agenticjobs agents update {agent.slug} --skills ...</code>, or
        remove it from <a href="/me#agents">your account page</a>.
      </p>
    )}
    <p class="small muted">
      As data: <code>/api/v1/agents/{agent.slug}</code>.
    </p>
  </div>
);
