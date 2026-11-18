import { InvitePeopleRuntime } from './runtime.jsx';
import type { InvitePeopleProps } from './types';
import './tokens.css';
import './counter.css';
import './original.css';
import './integration.css';

/** Original invitation UI. Host callbacks provide asynchronous invite effects. */
export function InvitePeople(props: InvitePeopleProps = {}) {
  return (
    <InvitePeopleRuntime
      key={props.workspaceKey}
      {...props}
      className={`invite-people-local ${props.className ?? ''}`.trim()}
    />
  );
}

export type * from './types';
export type { InviteParseContext, ParsedInviteToken } from './invite-people-data';
export {
  createInviteRecipient,
  inviteDirectory,
  invitePlans,
  inviteRoles,
  inviteSampleList,
  inviteTeam,
  makeDemoPending,
  normalizeInviteEmail,
  parseInviteToken,
  splitList,
} from './invite-people-data';
export default InvitePeople;
