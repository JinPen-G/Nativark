import { people } from '../primitives/media';
import type {
  InvitePerson,
  InvitePlan,
  InviteRecipient,
  InviteRole,
  PendingInvite,
} from './types';

export const exampleDomain = 'fieldwork.example';
export const emailPattern = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[a-z]{2,}$/i;
export const normalizeInviteEmail = (email: string) =>
  email.trim().toLowerCase();

export const inviteRoles: readonly InviteRole[] = [
  {
    value: 'admin',
    label: 'Admin',
    description: 'Manages members and billing',
  },
  {
    value: 'member',
    label: 'Member',
    description: 'Creates and edits projects',
  },
  { value: 'guest', label: 'Guest', description: 'Views shared projects only' },
];

export const inviteDirectory: readonly InvitePerson[] = people.map(
  (person) => ({
    email: `${person.id.replace('-', '.')}@${exampleDomain}`,
    name: person.name,
    title: person.role,
    src: person.src,
  }),
);

function findExamplePerson(id: string): InvitePerson {
  return inviteDirectory.find(
    (person) => person.email === `${id.replace('-', '.')}@${exampleDomain}`,
  )!;
}

export const inviteTeam: readonly InvitePerson[] = [
  'diane-foster',
  'nathan-cole',
  'jasmine-brooks',
  'daniel-kim',
  'chloe-nguyen',
].map(findExamplePerson);

export const invitePlans: Readonly<Record<string, InvitePlan>> = {
  starter: { name: 'Starter', seats: 10 },
  team: { name: 'Team', seats: 25 },
};

export const inviteSampleList =
  'emma.collins@fieldwork.example, Marcus Johnson, sofia.ramirez@fieldwork.example, olivia@northwind, jordan.reyes@, Nathan Cole, Ava Mitchell <ava.mitchell@fieldwork.example>, hannah.walsh@fieldwork.example, alex turner, emma.collins@fieldwork.example';

export function makeDemoPending(): PendingInvite[] {
  const entry = findExamplePerson('tyler-hayes');
  return [
    {
      key: entry.email,
      entry,
      role: 'member',
      status: 'sent',
      note: 'Sent 2 days ago',
    },
  ];
}

/** Matches the public preview's comma, semicolon, newline and multi-email splitting. */
export function splitList(text: string): string[] {
  return /[,;\n]/.test(text)
    ? text.split(/[,;\n]+/)
    : (text.match(/@/g)?.length ?? 0) > 1
      ? text.split(/\s+/)
      : [text];
}

export function createInviteRecipient(
  entry: InvitePerson,
  role = 'member',
): InviteRecipient {
  return {
    kind: 'ok',
    key: normalizeInviteEmail(entry.email),
    entry: { ...entry, email: normalizeInviteEmail(entry.email) },
    role,
    flown: false,
  };
}

export interface InviteParseContext {
  directory: readonly InvitePerson[];
  team: ReadonlySet<string>;
  pending: ReadonlySet<string>;
  domain?: string;
}

export type ParsedInviteToken =
  | { kind: 'ok'; entry: InvitePerson }
  | { kind: 'error'; text: string; message: string }
  | null;

/** Format and supplied-list checks only. The host performs authoritative account validation. */
export function parseInviteToken(
  token: string,
  context: InviteParseContext,
): ParsedInviteToken {
  const bracketed = token.match(/<\s*([^<>\s]+)\s*>/);
  const text = (bracketed ? bracketed[1] : token)
    .trim()
    .replace(/^["']+|["']+$/g, '')
    .trim();
  if (!text) return null;
  const normalized = text.toLowerCase().replace(/\s+/g, ' ');
  const person =
    context.directory.find(
      (entry) => entry.name?.toLowerCase() === normalized,
    ) ??
    (emailPattern.test(text)
      ? (context.directory.find(
          (entry) => normalizeInviteEmail(entry.email) === normalized,
        ) ?? { email: normalized })
      : undefined);
  if (person) {
    const name = person.name ?? person.email;
    const email = normalizeInviteEmail(person.email);
    if (context.team.has(email))
      return { kind: 'error', text, message: `${name} is already on the team` };
    if (context.pending.has(email))
      return {
        kind: 'error',
        text,
        message: `${name} already has a pending invite`,
      };
    return { kind: 'ok', entry: { ...person, email } };
  }
  const quoted = `“${text}”`;
  if (!text.includes('@'))
    return { kind: 'error', text, message: `${quoted} isn’t an email address` };
  const at = text.lastIndexOf('@');
  const local = text.slice(0, at);
  const domain = text.slice(at + 1);
  if (!local)
    return {
      kind: 'error',
      text,
      message: `${quoted} is missing a name before the @`,
    };
  if (!domain)
    return { kind: 'error', text, message: `${quoted} is missing a domain` };
  if (!domain.includes('.'))
    return {
      kind: 'error',
      text,
      message: `${quoted} needs a full domain, like ${context.domain ?? exampleDomain}`,
    };
  return {
    kind: 'error',
    text,
    message: `${quoted} isn’t a valid email address`,
  };
}
