import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type SetStateAction,
} from 'react';
import {
  emailPattern,
  exampleDomain,
  inviteDirectory,
  invitePlans,
  inviteRoles,
  inviteTeam,
  makeDemoPending,
  normalizeInviteEmail,
} from './invite-people-data';
import type {
  InviteOperation,
  InvitePeopleProps,
  InvitePerson,
  InviteRecipient,
  InviteSelection,
  InviteSendResult,
  PendingInvite,
} from './types';

function useInviteValue<T>(
  value: T | undefined,
  defaultValue: T,
  onChange?: (next: T) => void,
) {
  const [internalValue, setInternalValue] = useState(defaultValue);
  const current = value ?? internalValue;
  const currentRef = useRef(current);
  currentRef.current = current;
  const optionsRef = useRef({ controlled: value !== undefined, onChange });
  optionsRef.current = { controlled: value !== undefined, onChange };
  const setValue = useCallback((update: SetStateAction<T>) => {
    const next =
      typeof update === 'function'
        ? (update as (previous: T) => T)(currentRef.current)
        : update;
    currentRef.current = next;
    if (!optionsRef.current.controlled) setInternalValue(next);
    optionsRef.current.onChange?.(next);
  }, []);
  return [current, setValue, currentRef] as const;
}

const inviteIdentity = (invite: PendingInvite) =>
  JSON.stringify([
    invite.key,
    invite.entry.email,
    invite.role,
    invite.status,
    invite.note,
  ]);
const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : String(error || 'The invitation could not be completed');

function requireInvitePromise<T>(result: Promise<T>): Promise<T> {
  if (!result || typeof result.then !== 'function')
    throw new Error('Invitation handlers must return a Promise');
  return result;
}

/** Keeps host-confirmed invite data separate from temporary sending rows and demo timers. */
export function useInvitePeopleState(
  props: InvitePeopleProps,
  reducedMotion: boolean,
) {
  const integrated =
    props.directory !== undefined ||
    props.roles !== undefined ||
    props.team !== undefined ||
    props.defaultTeam !== undefined ||
    props.selected !== undefined ||
    props.defaultSelected !== undefined ||
    props.pending !== undefined ||
    props.defaultPending !== undefined ||
    props.plan !== undefined ||
    props.plans !== undefined ||
    props.onSend !== undefined ||
    props.onResend !== undefined ||
    props.onRevoke !== undefined ||
    props.onUpgrade !== undefined ||
    props.defaultPlan !== undefined ||
    props.memberCount !== undefined ||
    props.onSelectedChange !== undefined ||
    props.onPendingChange !== undefined;
  const demo = props.demo ?? !integrated;
  const [team, setTeam, teamRef] = useInviteValue<readonly InvitePerson[]>(
    props.team,
    props.defaultTeam ?? (demo ? inviteTeam : []),
    (next) => props.onTeamChange?.([...next]),
  );
  const [pending, setPending, pendingRef] = useInviteValue<
    readonly PendingInvite[]
  >(
    props.pending,
    props.defaultPending ?? (demo ? makeDemoPending() : []),
    (next) => props.onPendingChange?.([...next]),
  );
  const [selected, setSelected, selectedRef] = useInviteValue<
    readonly InviteSelection[]
  >(props.selected, props.defaultSelected ?? [], (next) =>
    props.onSelectedChange?.([...next]),
  );
  const plans = props.plans ?? invitePlans;
  const initialPlan =
    props.defaultPlan ??
    (plans.starter ? 'starter' : (Object.keys(plans)[0] ?? ''));
  const [plan, setPlan, planRef] = useInviteValue(
    props.plan,
    initialPlan,
    props.onPlanChange,
  );
  const [sendingRows, setSendingRows] = useState<PendingInvite[]>([]);
  const [sending, setSending] = useState(false);
  const [rowOperations, setRowOperations] = useState<
    Record<string, 'resend' | 'revoke'>
  >({});
  const [resent, setResent] = useState<Record<string, boolean>>({});
  const [operationError, setOperationError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const timersRef = useRef(new Set<ReturnType<typeof setTimeout>>());
  const operationsRef = useRef(new Map<string, AbortController>());
  const generationRef = useRef(0);
  const demoJoinedRef = useRef(false);
  const mountedRef = useRef(true);
  const propsRef = useRef(props);
  propsRef.current = props;

  const cancelOperations = useCallback(() => {
    generationRef.current += 1;
    operationsRef.current.forEach((controller) => controller.abort());
    operationsRef.current.clear();
    timersRef.current.forEach((timer) => clearTimeout(timer));
    timersRef.current.clear();
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancelOperations();
    };
  }, [cancelOperations]);

  const scheduleFeedback = useCallback(
    (delay: number, callback: () => void) => {
      const generation = generationRef.current;
      const timer = setTimeout(() => {
        timersRef.current.delete(timer);
        if (mountedRef.current && generation === generationRef.current)
          callback();
      }, delay);
      timersRef.current.add(timer);
    },
    [],
  );

  const reportError = (
    operation: InviteOperation,
    error: unknown,
    emails: readonly string[],
  ) => {
    const message = errorMessage(error);
    setOperationError(message);
    setAnnouncement(message);
    propsRef.current.onError?.({ operation, message, emails });
  };

  const liveOperation = (
    key: string,
    controller: AbortController,
    generation: number,
  ) =>
    mountedRef.current &&
    !controller.signal.aborted &&
    generation === generationRef.current &&
    operationsRef.current.get(key) === controller;

  function restoreRecipients(recipients: readonly InviteRecipient[]) {
    const teamEmails = new Set(
      teamRef.current.map((person) => normalizeInviteEmail(person.email)),
    );
    const pendingEmails = new Set(
      pendingRef.current.map((invite) =>
        normalizeInviteEmail(invite.entry.email),
      ),
    );
    setSelected((previous) => {
      const retained = [...previous];
      for (const recipient of recipients) {
        const email = normalizeInviteEmail(recipient.entry.email);
        if (
          !teamEmails.has(email) &&
          !pendingEmails.has(email) &&
          !retained.some(
            (item) =>
              item.kind === 'ok' &&
              normalizeInviteEmail(item.entry.email) === email,
          )
        )
          retained.push(recipient);
      }
      return retained;
    });
  }

  function demoSend(recipients: readonly InviteRecipient[]) {
    const rows: PendingInvite[] = recipients.map((recipient) => ({
      key: recipient.key,
      entry: recipient.entry,
      role: recipient.role,
      status: 'sending',
      note: 'Sending',
    }));
    setSelected((previous) =>
      previous.filter((item) => !rows.some((row) => row.key === item.key)),
    );
    setPending((previous) => [...rows, ...previous]);
    setAnnouncement(
      `Sending ${rows.length} ${rows.length === 1 ? 'invite' : 'invites'}`,
    );
    const stagger = reducedMotion ? 0 : 160;
    const delay = reducedMotion ? 300 : 700;
    rows.forEach((row, index) =>
      scheduleFeedback(delay + index * stagger, () => {
        setPending((previous) =>
          previous.map((item) =>
            item.key === row.key && item.status === 'sending'
              ? { ...item, status: 'sent', note: 'Sent just now' }
              : item,
          ),
        );
      }),
    );
    const completionTime = delay + rows.length * stagger;
    scheduleFeedback(completionTime, () =>
      setAnnouncement(
        `${rows.length} ${rows.length === 1 ? 'invite' : 'invites'} sent`,
      ),
    );
    if (demoJoinedRef.current || !rows[0]) return;
    demoJoinedRef.current = true;
    const first = rows[0];
    scheduleFeedback(completionTime + 2400, () => {
      if (
        !pendingRef.current.some(
          (item) => item.key === first.key && item.status === 'sent',
        )
      ) {
        demoJoinedRef.current = false;
        return;
      }
      setPending((previous) =>
        previous.map((item) =>
          item.key === first.key
            ? { ...item, status: 'joined', note: 'Joined' }
            : item,
        ),
      );
      setAnnouncement(
        `${first.entry.name ?? first.entry.email} accepted and joined ${propsRef.current.workspaceName ?? 'Fieldwork'}`,
      );
      scheduleFeedback(1200, () => {
        if (
          !pendingRef.current.some(
            (item) => item.key === first.key && item.status === 'joined',
          )
        )
          return;
        setPending((previous) =>
          previous.filter((item) => item.key !== first.key),
        );
        setTeam((previous) => [first.entry, ...previous]);
      });
    });
  }

  async function sendInvites(recipients: readonly InviteRecipient[]) {
    if (
      propsRef.current.disabled ||
      operationsRef.current.has('send') ||
      !recipients.length
    )
      return;
    setOperationError(null);
    const currentProps = propsRef.current;
    const unavailable = new Set([
      ...teamRef.current.map((person) => normalizeInviteEmail(person.email)),
      ...pendingRef.current.map((invite) =>
        normalizeInviteEmail(invite.entry.email),
      ),
    ]);
    const allowedRoles = new Set(
      (currentProps.roles ?? inviteRoles)
        .filter((role) => !role.disabled)
        .map((role) => role.value),
    );
    const emails = recipients.map((recipient) =>
      normalizeInviteEmail(recipient.entry.email),
    );
    if (
      new Set(emails).size !== emails.length ||
      recipients.some(
        (recipient) =>
          !emailPattern.test(recipient.entry.email) ||
          unavailable.has(normalizeInviteEmail(recipient.entry.email)) ||
          !allowedRoles.has(recipient.role),
      )
    ) {
      reportError(
        'send',
        new Error('Review the selected emails and roles before sending'),
        emails,
      );
      return;
    }
    if (!currentProps.onSend) {
      if (demo) demoSend(recipients);
      else
        reportError(
          'send',
          new Error('Connect an invitation sender to continue'),
          recipients.map((item) => item.entry.email),
        );
      return;
    }
    const controller = new AbortController();
    const generation = generationRef.current;
    const snapshot = recipients.map((recipient) => ({
      ...recipient,
      entry: { ...recipient.entry },
    }));
    operationsRef.current.set('send', controller);
    setSending(true);
    setSendingRows(
      snapshot.map((item) => ({
        key: item.key,
        entry: item.entry,
        role: item.role,
        status: 'sending',
        note: 'Sending',
      })),
    );
    setSelected((previous) =>
      previous.filter(
        (item) => !snapshot.some((recipient) => recipient.key === item.key),
      ),
    );
    setAnnouncement(
      `Sending ${snapshot.length} ${snapshot.length === 1 ? 'invite' : 'invites'}`,
    );
    try {
      const result = await requireInvitePromise(
        currentProps.onSend(snapshot, { signal: controller.signal }),
      );
      if (!liveOperation('send', controller, generation)) return;
      const confirmed =
        result === undefined
          ? snapshot.map((item) => ({
              key: item.key,
              entry: item.entry,
              role: item.role,
              status: 'sent' as const,
              note: 'Sent just now',
            }))
          : Array.isArray(result)
            ? [...result]
            : [...(result as InviteSendResult).sent];
      const failures =
        result && !Array.isArray(result)
          ? [...((result as InviteSendResult).failed ?? [])]
          : [];
      const requestedEmails = new Set(
        snapshot.map((item) => normalizeInviteEmail(item.entry.email)),
      );
      const accounted = new Set<string>();
      for (const item of [...confirmed, ...failures]) {
        const email = normalizeInviteEmail(
          'entry' in item ? item.entry.email : item.email,
        );
        if (!requestedEmails.has(email) || accounted.has(email))
          throw new Error(
            'The invitation sender returned inconsistent recipient results',
          );
        accounted.add(email);
      }
      for (const item of confirmed) {
        if (
          !['sent', 'joined'].includes(item.status) ||
          !item.key ||
          !item.role
        )
          throw new Error(
            'The invitation sender returned an unconfirmed invitation',
          );
      }
      if (new Set(confirmed.map((item) => item.key)).size !== confirmed.length)
        throw new Error(
          'The invitation sender returned duplicate invitation IDs',
        );
      for (const item of snapshot) {
        const email = normalizeInviteEmail(item.entry.email);
        if (!accounted.has(email))
          failures.push({
            email,
            message: 'The invitation sender did not confirm this recipient',
          });
      }
      setPending((previous) => {
        const added: PendingInvite[] = [];
        const teamEmails = new Set(
          teamRef.current.map((person) => normalizeInviteEmail(person.email)),
        );
        for (const invite of confirmed) {
          const email = normalizeInviteEmail(invite.entry.email);
          if (
            !teamEmails.has(email) &&
            !previous.some(
              (item) =>
                item.key === invite.key ||
                normalizeInviteEmail(item.entry.email) === email,
            )
          )
            added.push({ ...invite, entry: { ...invite.entry, email } });
        }
        return [...added, ...previous];
      });
      restoreRecipients(
        snapshot.filter((item) =>
          failures.some(
            (failure) =>
              normalizeInviteEmail(failure.email) ===
              normalizeInviteEmail(item.entry.email),
          ),
        ),
      );
      if (failures.length)
        reportError(
          'send',
          new Error(
            failures.map((item) => `${item.email}: ${item.message}`).join('\n'),
          ),
          failures.map((item) => item.email),
        );
      else
        setAnnouncement(
          `${confirmed.length} ${confirmed.length === 1 ? 'invite' : 'invites'} sent`,
        );
    } catch (error) {
      if (!liveOperation('send', controller, generation)) return;
      restoreRecipients(snapshot);
      reportError(
        'send',
        error,
        snapshot.map((item) => item.entry.email),
      );
    } finally {
      if (liveOperation('send', controller, generation)) {
        operationsRef.current.delete('send');
        setSendingRows([]);
        setSending(false);
      }
    }
  }

  async function runRowOperation(
    operation: 'resend' | 'revoke',
    invite: PendingInvite,
  ) {
    const key = `row:${invite.key}`;
    if (
      propsRef.current.disabled ||
      invite.status !== 'sent' ||
      operationsRef.current.has(key)
    )
      return;
    const handler =
      operation === 'resend'
        ? propsRef.current.onResend
        : propsRef.current.onRevoke;
    const controller = new AbortController();
    const generation = generationRef.current;
    const identity = inviteIdentity(invite);
    if (!handler && !demo) {
      reportError(
        operation,
        new Error(
          `Connect an invitation ${operation === 'resend' ? 'resender' : 'revoker'} to continue`,
        ),
        [invite.entry.email],
      );
      return;
    }
    operationsRef.current.set(key, controller);
    setRowOperations((previous) => ({ ...previous, [invite.key]: operation }));
    setOperationError(null);
    try {
      const result = handler
        ? await requireInvitePromise(
            handler(invite, { signal: controller.signal }),
          )
        : undefined;
      if (!liveOperation(key, controller, generation)) return;
      const current = pendingRef.current.find(
        (item) => item.key === invite.key,
      );
      if (!current || inviteIdentity(current) !== identity) return;
      if (operation === 'revoke') {
        setPending((previous) =>
          previous.filter((item) => item.key !== invite.key),
        );
        setAnnouncement(
          `Revoked the invite for ${invite.entry.name ?? invite.entry.email}. One seat freed.`,
        );
        return true;
      } else {
        if (
          result &&
          (result.key !== invite.key ||
            normalizeInviteEmail(result.entry.email) !==
              normalizeInviteEmail(invite.entry.email) ||
            !['sent', 'joined'].includes(result.status))
        )
          throw new Error(
            'The invitation resender returned a different invitation',
          );
        if (result)
          setPending((previous) =>
            previous.map((item) => (item.key === invite.key ? result : item)),
          );
        setResent((previous) => ({ ...previous, [invite.key]: true }));
        setAnnouncement(
          `Invite sent again to ${invite.entry.name ?? invite.entry.email}`,
        );
        scheduleFeedback(2000, () =>
          setResent((previous) => ({ ...previous, [invite.key]: false })),
        );
      }
    } catch (error) {
      if (liveOperation(key, controller, generation))
        reportError(operation, error, [invite.entry.email]);
    } finally {
      if (liveOperation(key, controller, generation)) {
        operationsRef.current.delete(key);
        setRowOperations((previous) => {
          const next = { ...previous };
          delete next[invite.key];
          return next;
        });
      }
    }
    return false;
  }

  async function upgradePlan(nextPlan: string) {
    if (
      propsRef.current.disabled ||
      operationsRef.current.has('upgrade') ||
      !plans[nextPlan]
    )
      return;
    if (!propsRef.current.onUpgrade && !demo) {
      reportError(
        'upgrade',
        new Error('Connect a plan change handler to continue'),
        [],
      );
      return;
    }
    const controller = new AbortController();
    const generation = generationRef.current;
    const previousPlan = planRef.current;
    operationsRef.current.set('upgrade', controller);
    try {
      if (propsRef.current.onUpgrade)
        await requireInvitePromise(
          propsRef.current.onUpgrade(nextPlan, { signal: controller.signal }),
        );
      if (
        !liveOperation('upgrade', controller, generation) ||
        planRef.current !== previousPlan
      )
        return;
      setPlan(nextPlan);
      setAnnouncement(
        `Upgraded to the ${plans[nextPlan].name} plan with ${plans[nextPlan].seats} seats.`,
      );
    } catch (error) {
      if (liveOperation('upgrade', controller, generation))
        reportError('upgrade', error, []);
    } finally {
      if (liveOperation('upgrade', controller, generation))
        operationsRef.current.delete('upgrade');
    }
  }

  function reset() {
    cancelOperations();
    setSending(false);
    setSendingRows([]);
    setRowOperations({});
    setResent({});
    setOperationError(null);
    setSelected(propsRef.current.defaultSelected ?? []);
    demoJoinedRef.current = false;
    if (demo) {
      setTeam(propsRef.current.defaultTeam ?? inviteTeam);
      setPending(propsRef.current.defaultPending ?? makeDemoPending());
      setPlan(initialPlan);
    }
    propsRef.current.onReset?.();
    setAnnouncement('Preview reset');
  }

  return {
    directory: props.directory ?? (demo ? inviteDirectory : []),
    roles: props.roles ?? inviteRoles,
    defaultRole:
      props.defaultRole ??
      (props.roles ?? inviteRoles).find(
        (role) => role.value === 'member' && !role.disabled,
      )?.value ??
      (props.roles ?? inviteRoles).find((role) => !role.disabled)?.value ??
      '',
    domain: props.emailDomain ?? exampleDomain,
    plans,
    plan,
    team,
    selected,
    setSelected,
    selectedRef,
    pending: [
      ...sendingRows.filter(
        (row) =>
          !pending.some(
            (item) =>
              normalizeInviteEmail(item.entry.email) ===
              normalizeInviteEmail(row.entry.email),
          ),
      ),
      ...pending,
    ],
    pendingRef,
    sending,
    resent,
    rowOperations,
    operationError,
    setOperationError,
    announcement,
    setAnnouncement,
    scheduleFeedback,
    sendInvites,
    resendInvite: (invite: PendingInvite) => runRowOperation('resend', invite),
    revokeInvite: (invite: PendingInvite) => runRowOperation('revoke', invite),
    upgradePlan,
    reset,
  };
}
