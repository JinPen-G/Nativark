import type { CSSProperties, ReactNode } from 'react';

export interface InvitePerson {
  email: string;
  name?: string;
  title?: string;
  src?: string;
}

export interface InviteRole {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

export interface InvitePlan {
  name: string;
  seats: number;
}

export interface InviteRecipient {
  kind: 'ok';
  key: string;
  entry: InvitePerson;
  role: string;
  flown?: boolean;
}

export interface InviteInvalidEntry {
  kind: 'error';
  key: string;
  text: string;
  message: string;
}

export type InviteSelection = InviteRecipient | InviteInvalidEntry;

export interface PendingInvite {
  key: string;
  entry: InvitePerson;
  role: string;
  status: 'sending' | 'sent' | 'joined';
  note: string;
}

export interface InviteFailure {
  email: string;
  message: string;
}

export interface InviteSendResult {
  sent: readonly PendingInvite[];
  failed?: readonly InviteFailure[];
}

export interface InviteOperationContext {
  signal: AbortSignal;
}

export type InviteOperation = 'send' | 'resend' | 'revoke' | 'upgrade';

export interface InviteOperationError {
  operation: InviteOperation;
  message: string;
  emails: readonly string[];
}

export interface InviteConfigurationContext {
  selected: readonly InviteSelection[];
  pending: readonly PendingInvite[];
  sending: boolean;
}

/** Reproduces the original invite UI while letting the host own data and async effects. */
export interface InvitePeopleProps {
  /** 宿主没有席位方案时省略容量 UI 和演示容量校验。 */
  showSeats?: boolean;
  showTeam?: boolean;
  canResend?: boolean;
  sendDisabled?: boolean;
  directory?: readonly InvitePerson[];
  roles?: readonly InviteRole[];
  defaultRole?: string;
  team?: readonly InvitePerson[];
  defaultTeam?: readonly InvitePerson[];
  onTeamChange?: (team: InvitePerson[]) => void;
  selected?: readonly InviteSelection[];
  defaultSelected?: readonly InviteSelection[];
  onSelectedChange?: (selected: InviteSelection[]) => void;
  pending?: readonly PendingInvite[];
  defaultPending?: readonly PendingInvite[];
  onPendingChange?: (pending: PendingInvite[]) => void;
  plans?: Readonly<Record<string, InvitePlan>>;
  plan?: string;
  defaultPlan?: string;
  onPlanChange?: (plan: string) => void;
  memberCount?: number;
  workspaceName?: string;
  workspaceKey?: string | number;
  title?: ReactNode;
  subtitle?: ReactNode;
  placeholder?: string;
  emailDomain?: string;
  sampleList?: string | false;
  demo?: boolean;
  disabled?: boolean;
  onSend?: (
    recipients: readonly InviteRecipient[],
    context: InviteOperationContext,
  ) => Promise<void | readonly PendingInvite[] | InviteSendResult>;
  onResend?: (
    invite: PendingInvite,
    context: InviteOperationContext,
  ) => Promise<void | PendingInvite>;
  onRevoke?: (
    invite: PendingInvite,
    context: InviteOperationContext,
  ) => Promise<void>;
  onUpgrade?: (plan: string, context: InviteOperationContext) => Promise<void>;
  onError?: (error: InviteOperationError) => void;
  onReset?: () => void;
  configurationSlot?:
    | ReactNode
    | ((context: InviteConfigurationContext) => ReactNode);
  footerSlot?: ReactNode;
  className?: string;
  style?: CSSProperties;
}
