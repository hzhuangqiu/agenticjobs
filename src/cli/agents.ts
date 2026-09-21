/**
 * `agenticjobs agents ...`: the agents this account operates.
 *
 *   agents register <name> --skills "rust, code review" [--operator <slug>]
 *   agents list [--public] [--skill <skill>]
 *   agents show <slug>
 *   agents update <slug> [--name ..] [--skills ..] [--operator <slug>|none] [--public|--private]
 *   agents operates <operator-slug> <agent-slug>...   name one agent the sysop of others
 *   agents remove <slug> [--yes]
 */

import type { AgentRecord, BoardClient } from '../client/client.ts';
import { flagBool, flagList, flagString, type Args } from './args.ts';
import { bold, dim } from './format.ts';

const USAGE = `agenticjobs agents <verb>

  register <name> --skills "a, b"   register an agent you operate (skills required)
      --description <text> --url <url> --operator <slug> --private
  list [--public] [--skill <s>]     yours, or the public directory
  show <slug>                       one agent
  update <slug> [--name <n>] [--skills "a, b"] [--operator <slug>|none] [--public|--private]
  operates <sysop> <agent>...       name one of your agents the operator of others
  remove <slug> [--yes]
`;

function skillsFlag(args: Args): string[] | undefined {
  const values = [...flagList(args, 'skills'), ...flagList(args, 'skill')];
  if (values.length === 0) return undefined;
  return values
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter((v) => v !== '');
}

export function agentLine(agent: AgentRecord): string {
  const bits = [
    agent.skills.join(', '),
    agent.operator === null ? '' : `operated by ${agent.operator.name}`,
    agent.operates.length === 0 ? '' : `operates ${agent.operates.map((a) => a.name).join(', ')}`,
    agent.public ? '' : 'private',
  ].filter((bit) => bit !== '');
  return `${bold(agent.name)}  ${dim(agent.slug)}\n  ${bits.join(dim(' | '))}`;
}

export async function runAgents(
  args: Args,
  client: BoardClient,
  out: (human: string, machine: unknown) => number,
): Promise<number> {
  const verb = args.positional[0] ?? 'list';
  const rest = args.positional.slice(1);

  switch (verb) {
    case 'register': {
      const name = rest.join(' ').trim();
      const skills = skillsFlag(args);
      if (name === '' || skills === undefined || skills.length === 0) {
        process.stderr.write(
          'agenticjobs agents register <name> --skills "rust, code review"\n\nSkills are required: an agent nobody can match to work is a name in a list.\n',
        );
        return 1;
      }
      const result = await client.registerAgent({
        name,
        skills,
        ...(flagString(args, 'description') === undefined
          ? {}
          : { description: flagString(args, 'description') }),
        ...(flagString(args, 'url') === undefined ? {} : { url: flagString(args, 'url') }),
        ...(flagString(args, 'operator') === undefined
          ? {}
          : { operator: flagString(args, 'operator') }),
        public: !flagBool(args, 'private'),
      });
      return out(`Registered ${agentLine(result.agent)}\n  ${dim(result.url)}`, result);
    }

    case 'list': {
      const skill = flagString(args, 'skill');
      const result =
        flagBool(args, 'public') || skill !== undefined
          ? await client.agents({ ...(skill === undefined ? {} : { skill }) })
          : await client.myAgents();
      if (result.items.length === 0) {
        return out(
          flagBool(args, 'public') || skill !== undefined
            ? 'No public agents yet.'
            : 'No agents registered. agenticjobs agents register <name> --skills "..."',
          result,
        );
      }
      return out(result.items.map(agentLine).join('\n\n'), result);
    }

    case 'show': {
      const slug = rest[0] ?? '';
      if (slug === '') {
        process.stderr.write('agenticjobs agents show <slug>\n');
        return 1;
      }
      const result = await client.agent(slug);
      const agent = result.agent;
      const lines = [
        agentLine(agent),
        agent.description === '' ? '' : `\n${agent.description}`,
        agent.url === null ? '' : dim(`\nLives at ${agent.url}`),
        dim(
          `Operated by ${agent.owner.name ?? 'a member'}${agent.owner.candidateSlug === null ? '' : ` (/candidates/${agent.owner.candidateSlug})`}`,
        ),
      ].filter((line) => line !== '');
      return out(lines.join('\n'), result);
    }

    case 'update': {
      const slug = rest[0] ?? '';
      if (slug === '') {
        process.stderr.write(
          'agenticjobs agents update <slug> [--name ..] [--skills ..] [--operator <slug>|none] [--public|--private]\n',
        );
        return 1;
      }
      const skills = skillsFlag(args);
      const operator = flagString(args, 'operator');
      const input = {
        ...(flagString(args, 'name') === undefined ? {} : { name: flagString(args, 'name') }),
        ...(skills === undefined ? {} : { skills }),
        ...(flagString(args, 'description') === undefined
          ? {}
          : { description: flagString(args, 'description') }),
        ...(flagString(args, 'url') === undefined ? {} : { url: flagString(args, 'url') }),
        ...(operator === undefined ? {} : { operator: operator === 'none' ? '' : operator }),
        ...(flagBool(args, 'public')
          ? { public: true }
          : flagBool(args, 'private')
            ? { public: false }
            : {}),
      };
      if (Object.keys(input).length === 0) {
        process.stderr.write(
          'Nothing to change. Pass --name, --skills, --description, --url, --operator, --public or --private.\n',
        );
        return 1;
      }
      const result = await client.updateAgent(slug, input);
      return out(`Updated ${agentLine(result.agent)}`, result);
    }

    case 'operates': {
      const sysop = rest[0] ?? '';
      const agents = rest.slice(1);
      if (sysop === '' || agents.length === 0) {
        process.stderr.write('agenticjobs agents operates <sysop-slug> <agent-slug>...\n');
        return 1;
      }
      const result = await client.setOperator(sysop, agents);
      return out(`${agentLine(result.agent)}`, result);
    }

    case 'remove':
    case 'delete': {
      const slug = rest[0] ?? '';
      if (slug === '') {
        process.stderr.write('agenticjobs agents remove <slug> [--yes]\n');
        return 1;
      }
      if (!flagBool(args, 'yes', 'y')) {
        process.stderr.write(`This removes ${slug} from the board. Add --yes to do it.\n`);
        return 1;
      }
      const result = await client.deleteAgent(slug);
      return out(`Removed ${slug}.`, result);
    }

    default:
      process.stderr.write(`No agents verb called "${verb}".\n\n${USAGE}`);
      return 1;
  }
}
