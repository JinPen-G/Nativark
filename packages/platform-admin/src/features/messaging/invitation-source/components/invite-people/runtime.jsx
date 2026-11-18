/** UIARC public preview port. Source and adaptations are recorded in provenance.json. */
import {
  exampleDomain,
  emailPattern,
  inviteRoles,
  inviteDirectory,
  inviteTeam,
  invitePlans,
  makeDemoPending,
  inviteSampleList,
  normalizeInviteEmail,
  parseInviteToken,
  splitList,
} from './invite-people-data';
import { useInvitePeopleState } from './useInvitePeopleState';
import { useInviteText } from '../../locale';
import { compactMotionTokens, useReducedMotion } from '../primitives/motion';
import * as React from 'react';
import {
  motion,
  AnimatePresence,
  MotionConfig,
  LayoutGroup,
} from 'motion/react';
import { default as styles } from './classes.json';
import { SourceImage } from '../primitives/SourceImage';
import {
  CircleAlert,
  X,
  ChevronDown,
  Mail,
  ClipboardPaste,
  RotateCcw,
  Send,
  LoaderCircle,
  Check,
} from './reference-icons';
import { AnimatedCounter } from '../../screens/shared/AnimatedCounter.jsx';
let { spring, duration, ease, blur } = compactMotionTokens,
  enterEase = [...ease.enter],
  morphTransition = { ...spring.morph },
  shakeFrames = [
    [0, -6, 6, -4, 4, -2, 0],
    [0, 6, -6, 4, -4, 2, 0],
  ],
  iconProps = { size: 16, strokeWidth: 1.75, 'aria-hidden': true },
  classNames = (...names) => names.filter(Boolean).join(' '),
  plural = (count, singular, pluralForm = `${singular}s`) =>
    `${count} ${count === 1 ? singular : pluralForm}`,
  subscribeHydrated = () => () => {};
function useInviteReducedMotion() {
  const hydrated = React.useSyncExternalStore(
    subscribeHydrated,
    () => true,
    () => false,
  );
  return !!useReducedMotion() && hydrated;
}
function AutoWidth({ children, className }) {
  const reducedMotion = useInviteReducedMotion();
  const measureRef = React.useRef(null);
  const [width, setWidth] = React.useState('auto');
  React.useLayoutEffect(() => {
    const element = measureRef.current;
    if (!element || typeof ResizeObserver === 'undefined') {
      return;
    }
    const resizeObserver = new ResizeObserver(() =>
      setWidth(element.offsetWidth),
    );
    resizeObserver.observe(element);
    return () => resizeObserver.disconnect();
  }, []);
  return (
    <motion.span
      className={classNames(styles.autoWidth, className)}
      initial={false}
      animate={{ width }}
      transition={reducedMotion ? { duration: 0 } : spring.morph}
    >
      <span ref={measureRef} className={styles.autoWidthInner}>
        {children}
      </span>
    </motion.span>
  );
}
function AutoHeight({ children, className, decor }) {
  const reducedMotion = useInviteReducedMotion();
  const measureRef = React.useRef(null);
  const [height, setHeight] = React.useState('auto');
  React.useLayoutEffect(() => {
    const element = measureRef.current;
    if (!element || typeof ResizeObserver === 'undefined') {
      return;
    }
    const resizeObserver = new ResizeObserver(() =>
      setHeight(element.offsetHeight),
    );
    resizeObserver.observe(element);
    return () => resizeObserver.disconnect();
  }, []);
  return (
    <motion.div
      className={className}
      initial={false}
      animate={{ height }}
      transition={reducedMotion ? { duration: 0 } : spring.smooth}
    >
      {decor}
      <div ref={measureRef}>{children}</div>
    </motion.div>
  );
}
function Swap({ id, children }) {
  const reducedMotion = useInviteReducedMotion();
  return (
    <span className={styles.swap}>
      <AnimatePresence initial={false} mode={'popLayout'}>
        <motion.span
          key={id}
          className={styles.swapItem}
          initial={
            reducedMotion
              ? { opacity: 0 }
              : { opacity: 0, y: '0.4em', filter: `blur(${blur.subtle}px)` }
          }
          animate={{
            opacity: 1,
            y: '0em',
            filter: 'blur(0px)',
            transitionEnd: { filter: 'none' },
          }}
          exit={
            reducedMotion
              ? { opacity: 0, transition: { duration: 0 } }
              : {
                  opacity: 0,
                  y: '-0.4em',
                  filter: `blur(${blur.subtle}px)`,
                  transition: { duration: duration.fast },
                }
          }
          transition={
            reducedMotion
              ? { duration: duration.instant }
              : { duration: duration.standard, ease: enterEase }
          }
        >
          {children}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
function Collapse({ children, className }) {
  const reducedMotion = useInviteReducedMotion();
  return (
    <motion.div
      className={classNames(styles.collapse, className)}
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={
        reducedMotion
          ? { duration: 0 }
          : { height: spring.smooth, opacity: { duration: duration.standard } }
      }
    >
      {children}
    </motion.div>
  );
}
function Avatar({ entry, size, layoutId, alt = '' }) {
  return (
    <motion.span
      layoutId={layoutId}
      className={styles.avatar}
      style={{ width: size, height: size, borderRadius: '50%' }}
      transition={{ layout: morphTransition }}
    >
      {entry.src ? (
        <SourceImage
          style={{ color: 'transparent' }}
          src={entry.src}
          alt={alt}
          width={size}
          height={size}
          sizes={`${size}px`}
          draggable={false}
        />
      ) : (
        <span
          className={styles.initial}
          aria-hidden={!alt || undefined}
          role={alt ? 'img' : undefined}
          aria-label={alt || undefined}
        >
          {entry.email.charAt(0).toUpperCase()}
        </span>
      )}
    </motion.span>
  );
}
function InvitePeopleRuntime(props = {}) {
  const t = useInviteText();
  let instanceId = React.useId(),
    reducedMotion = useInviteReducedMotion(),
    rootRef = React.useRef(null),
    inputRef = React.useRef(null),
    roleMenuRef = React.useRef(null),
    roleTriggerRef = React.useRef(null),
    pendingHeadingRef = React.useRef(null),
    nextErrorIdRef = React.useRef(0),
    [query, setQuery] = React.useState(''),
    [focused, setFocused] = React.useState(false),
    [suggestionsClosed, setSuggestionsClosed] = React.useState(false),
    [highlightIndex, setHighlightIndex] = React.useState(0),
    [navigated, setNavigated] = React.useState(false),
    [backspaceArmed, setBackspaceArmed] = React.useState(false),
    [roleMenu, setRoleMenu] = React.useState(null),
    [hint, setHint] = React.useState(null),
    [chipShake, setChipShake] = React.useState(0),
    [seatShake, setSeatShake] = React.useState(0),
    state = useInvitePeopleState(props, reducedMotion);
  const {
    team,
    pending,
    selected,
    setSelected,
    plan,
    plans,
    roles,
    directory,
    defaultRole,
    domain,
    resent,
    rowOperations,
    sending,
    operationError,
    setOperationError,
    announcement,
    setAnnouncement,
    scheduleFeedback,
  } = state;
  const roleLabel = (role) =>
    roles.find((item) => item.value === role)?.label ?? role;
  const avatarLayoutId = (email) =>
    reducedMotion ? undefined : `${instanceId}-avatar-${email}`;
  let validSelected = selected.filter((item) => 'ok' === item.kind),
    invalidSelected = selected.filter((item) => 'error' === item.kind),
    teamEmails = React.useMemo(
      () => new Set(team.map((item) => normalizeInviteEmail(item.email))),
      [team],
    ),
    pendingEmails = React.useMemo(
      () =>
        new Set(pending.map((item) => normalizeInviteEmail(item.entry.email))),
      [pending],
    ),
    joinedCount = pending.filter((item) => 'joined' === item.status).length,
    memberCount = (props.memberCount ?? team.length) + joinedCount,
    pendingCount = pending.length - joinedCount,
    selectedCount = validSelected.length,
    seatLimit = (plans[plan] ?? { name: 'Plan', seats: 0 }).seats,
    totalSeats = memberCount + pendingCount + selectedCount,
    overLimit = props.showSeats === false ? 0 : Math.max(0, totalSeats - seatLimit),
    sendBlocked =
      0 === selectedCount ||
      invalidSelected.length > 0 ||
      overLimit > 0 ||
      sending ||
      !!props.disabled || !!props.sendDisabled,
    suggestions = React.useMemo(() => {
      let normalizedQuery = query.trim().toLowerCase(),
        selectedEmails = new Set(
          selected.map((item) =>
            item.kind === 'ok'
              ? normalizeInviteEmail(item.entry.email)
              : item.key,
          ),
        ),
        getUnavailableReason = (person) =>
          teamEmails.has(normalizeInviteEmail(person.email))
            ? 'On the team'
            : pendingEmails.has(normalizeInviteEmail(person.email))
              ? 'Invited'
              : selectedEmails.has(normalizeInviteEmail(person.email))
                ? 'Added'
                : null;
      if (!normalizedQuery) {
        return directory
          .filter((item) => !getUnavailableReason(item))
          .slice(0, 4)
          .map((item) => ({
            id: item.email,
            kind: 'person',
            entry: item,
            note: item.title ?? '',
          }));
      }
      let matches = directory
        .filter(
          (item) =>
            (item.name ?? '').toLowerCase().includes(normalizedQuery) ||
            normalizeInviteEmail(item.email).includes(normalizedQuery),
        )
        .map((item) => {
          let unavailableReason = getUnavailableReason(item);
          return {
            id: item.email,
            kind: unavailableReason ? 'blocked' : 'person',
            entry: item,
            note: unavailableReason ?? item.title ?? '',
          };
        })
        .sort(
          (left, right) =>
            Number('blocked' === left.kind) - Number('blocked' === right.kind),
        )
        .slice(0, 5);
      if (
        emailPattern.test(normalizedQuery) &&
        !directory.some(
          (item) => normalizeInviteEmail(item.email) === normalizedQuery,
        ) &&
        !selectedEmails.has(normalizedQuery)
      ) {
        matches.unshift({
          id: `new:${normalizedQuery}`,
          kind:
            teamEmails.has(normalizedQuery) ||
            pendingEmails.has(normalizedQuery)
              ? 'blocked'
              : 'email',
          entry: { email: normalizedQuery },
          note: teamEmails.has(normalizedQuery)
            ? 'On the team'
            : pendingEmails.has(normalizedQuery)
              ? 'Invited'
              : 'Invite by email',
        });
      }
      return matches;
    }, [selected, pendingEmails, query, teamEmails, directory]),
    firstSuggestion = suggestions.findIndex((item) => 'blocked' !== item.kind),
    activeSuggestion =
      suggestions[highlightIndex] &&
      'blocked' !== suggestions[highlightIndex].kind
        ? highlightIndex
        : firstSuggestion,
    showSuggestions =
      !props.disabled &&
      focused &&
      !suggestionsClosed &&
      (suggestions.length > 0 || !!query.trim()),
    suggestionListId = `${instanceId}-list`,
    hintId = `${instanceId}-hint`,
    errorsId = `${instanceId}-errors`,
    seatsId = `${instanceId}-seats`,
    pendingId = `${instanceId}-pending`,
    showHint = (message) => {
      setHint(message);
      scheduleFeedback(3200, () =>
        setHint((previousHint) =>
          previousHint === message ? null : previousHint,
        ),
      );
    },
    addTokens = (text) => {
      let nextSelected = [...selected],
        addedCount = 0,
        invalidCount = 0,
        duplicateCount = 0;
      for (let token of splitList(text)) {
        let parsed = parseInviteToken(token, {
          directory,
          team: teamEmails,
          pending: pendingEmails,
          domain,
        });
        if (parsed) {
          if ('ok' === parsed.kind) {
            if (nextSelected.some((item) => item.key === parsed.entry.email)) {
              duplicateCount++;
              continue;
            }
            nextSelected.push({
              kind: 'ok',
              key: parsed.entry.email,
              entry: parsed.entry,
              role: defaultRole,
              flown: false,
            });
            addedCount++;
          } else {
            if (
              nextSelected.some(
                (item) =>
                  'error' === item.kind &&
                  item.text.toLowerCase() === parsed.text.toLowerCase(),
              )
            ) {
              duplicateCount++;
              continue;
            }
            nextSelected.push({
              kind: 'error',
              key: `error-${nextErrorIdRef.current++}`,
              text: parsed.text,
              message: parsed.message,
            });
            invalidCount++;
          }
        }
      }
      setSelected(nextSelected);
      setOperationError(null);
      setBackspaceArmed(false);
      let messages = [
        addedCount && `Added ${plural(addedCount, 'person', 'people')}`,
        invalidCount &&
          `${plural(invalidCount, 'entry', 'entries')} need a fix`,
        duplicateCount && `skipped ${plural(duplicateCount, 'duplicate')}`,
      ].filter(Boolean);
      if (messages.length) {
        let announcementText = messages
          .join(', ')
          .replace(/^./, (initialCharacter) => initialCharacter.toUpperCase());
        setAnnouncement(announcementText);
        (messages.length > 1 || duplicateCount) && showHint(announcementText);
      }
    },
    addSuggestion = (suggestion) => {
      if (suggestion && 'blocked' !== suggestion.kind) {
        setSelected((previousSelected) =>
          previousSelected.some((item) => item.key === suggestion.entry.email)
            ? previousSelected
            : [
                ...previousSelected,
                {
                  kind: 'ok',
                  key: normalizeInviteEmail(suggestion.entry.email),
                  entry: {
                    ...suggestion.entry,
                    email: normalizeInviteEmail(suggestion.entry.email),
                  },
                  role: defaultRole,
                  flown: 'person' === suggestion.kind,
                },
              ],
        );
        setQuery('');
        setHighlightIndex(0);
        setBackspaceArmed(false);
        setOperationError(null);
        setAnnouncement(
          `Added ${suggestion.entry.name ?? suggestion.entry.email}`,
        );
      }
    },
    removeChip = (key, label) => {
      setSelected((previousSelected) =>
        previousSelected.filter((item) => item.key !== key),
      );
      setBackspaceArmed(false);
      setAnnouncement(`Removed ${label}`);
      inputRef.current?.focus({ preventScroll: true });
    },
    openRoleMenu = (key, trigger) => {
      let root = rootRef.current;
      if (!root) {
        return;
      }
      if (roleMenu?.key === key) {
        setRoleMenu(null);
        return;
      }
      let rootBox = root.getBoundingClientRect(),
        triggerBox = trigger.getBoundingClientRect();
      roleTriggerRef.current = trigger;
      setRoleMenu({
        key,
        x: Math.max(
          8,
          Math.min(triggerBox.left - rootBox.left - 8, rootBox.width - 232 - 8),
        ),
        y: triggerBox.bottom - rootBox.top + 6,
      });
    },
    closeRoleMenu = (restoreFocus) => {
      setRoleMenu(null);
      restoreFocus && roleTriggerRef.current?.focus({ preventScroll: true });
    },
    roleSelection = roleMenu
      ? validSelected.find((item) => item.key === roleMenu.key)
      : undefined,
    roleSelectionKey = roleSelection?.key;
  React.useEffect(() => {
    if (!roleSelectionKey) {
      return;
    }
    roleMenuRef.current
      ?.querySelector('[aria-checked="true"]')
      ?.focus({ preventScroll: true });
    let closeOnOutsidePointer = (event) => {
      let target = event.target;
      if (
        !(
          roleMenuRef.current?.contains(target) ||
          roleTriggerRef.current?.contains(target)
        )
      ) {
        setRoleMenu(null);
      }
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () =>
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [roleSelectionKey]);
  let heightTransition = reducedMotion ? { duration: 0 } : spring.smooth,
    itemTransition = reducedMotion ? { duration: 0 } : spring.snappy,
    layoutTransition = reducedMotion ? { duration: 0 } : spring.smooth,
    shownTeam = team.slice(0, 5),
    extraTeam = team.length - shownTeam.length,
    seatPercentage = (seats) =>
      `${seatLimit > 0 ? Math.min(100, (seats / seatLimit) * 100) : 0}%`;
  return (
    <MotionConfig reducedMotion={reducedMotion ? 'always' : 'never'}>
      <LayoutGroup id={instanceId}>
        <section
          ref={rootRef}
          className={classNames(styles.root, props.className)}
          data-invite-reduced-motion={reducedMotion || undefined}
          style={props.style}
          aria-labelledby={`${instanceId}-title`}
        >
          <header className={styles.header}>
            <div className={styles.heading}>
              <h2 id={`${instanceId}-title`} className={styles.title}>
                {props.title ?? 'Invite teammates'}
              </h2>
              <p className={styles.subtitle}>
                {props.subtitle ??
                  `Add people to ${props.workspaceName ?? 'Fieldwork'} by name or email`}
              </p>
            </div>
            {props.showTeam !== false && <ul
              className={styles.team}
              aria-label={`${t('Team')} ${team.length}`}
            >
              <AnimatePresence initial={false} mode={'popLayout'}>
                {shownTeam.map((item) => (
                  <motion.li
                    key={item.email}
                    layout={'position'}
                    className={styles.teamItem}
                    initial={false}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ ...itemTransition, layout: layoutTransition }}
                  >
                    <Avatar
                      entry={item}
                      size={28}
                      layoutId={avatarLayoutId(item.email)}
                      alt={item.name ?? item.email}
                    />
                  </motion.li>
                ))}
                {extraTeam > 0 && (
                  <motion.li
                    key={'more'}
                    layout={'position'}
                    className={classNames(styles.teamItem, styles.teamMore)}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ ...itemTransition, layout: layoutTransition }}
                  >
                    <span aria-hidden={'true'}>
                      {'+'}
                      {extraTeam}
                    </span>
                    <span className={styles.srOnly}>
                      {'and '}
                      {extraTeam}
                      {' more'}
                    </span>
                  </motion.li>
                )}
              </AnimatePresence>
            </ul>}
          </header>
          <div className={styles.fieldWrap}>
            <AutoHeight
              className={styles.fieldShell}
              decor={<span className={styles.fieldSkin} aria-hidden={'true'} />}
            >
              <div
                className={styles.field}
                data-focused={focused || undefined}
                onClick={(event) => {
                  if (!event.target.closest('button, input')) {
                    inputRef.current?.focus();
                  }
                }}
              >
                <ul className={styles.chips} aria-label={t('People to invite')}>
                  <AnimatePresence initial={false} mode={'popLayout'}>
                    {selected.map((item) => {
                      if ('error' === item.kind) {
                        return (
                          <motion.li
                            key={item.key}
                            layout={'position'}
                            className={styles.chip}
                            data-kind={'error'}
                            data-armed={
                              (backspaceArmed &&
                                item === selected[selected.length - 1]) ||
                              undefined
                            }
                            initial={{ opacity: 0, x: 0 }}
                            animate={{
                              opacity: 1,
                              x: reducedMotion ? 0 : shakeFrames[chipShake % 2],
                            }}
                            exit={{
                              opacity: 0,
                              scale: 0.92,
                              transition: { duration: duration.fast },
                            }}
                            transition={{
                              opacity: { duration: duration.fast },
                              x: { duration: 0.42, ease: 'easeOut' },
                              layout: layoutTransition,
                            }}
                          >
                            <span
                              className={styles.chipSkin}
                              aria-hidden={'true'}
                            />
                            <button
                              type={'button'}
                              className={styles.errorEdit}
                              onClick={() => {
                                setSelected((previousSelected) =>
                                  previousSelected.filter(
                                    (item2) => item2.key !== item.key,
                                  ),
                                );
                                setQuery(item.text);
                                setSuggestionsClosed(false);
                                setAnnouncement(`Editing ${item.text}`);
                                const input = inputRef.current;
                                if (input) {
                                  input.focus({ preventScroll: true });
                                  requestAnimationFrame(() =>
                                    input.setSelectionRange(
                                      item.text.length,
                                      item.text.length,
                                    ),
                                  );
                                }
                              }}
                              aria-label={`Edit ${item.text}. ${item.message}`}
                              title={'Edit'}
                            >
                              <CircleAlert
                                size={14}
                                strokeWidth={1.75}
                                aria-hidden={'true'}
                              />
                              <span className={styles.chipLabel}>
                                {item.text}
                              </span>
                            </button>
                            <button
                              type={'button'}
                              className={styles.chipRemove}
                              aria-label={`Remove ${item.text}`}
                              onClick={() => removeChip(item.key, item.text)}
                            >
                              <X
                                size={14}
                                strokeWidth={1.75}
                                aria-hidden={'true'}
                              />
                            </button>
                          </motion.li>
                        );
                      }
                      let label = item.entry.name ?? item.entry.email,
                        menuOpen = roleMenu?.key === item.key;
                      return (
                        <motion.li
                          key={item.key}
                          layout={'position'}
                          className={styles.chip}
                          data-armed={
                            (backspaceArmed &&
                              item === selected[selected.length - 1]) ||
                            undefined
                          }
                          initial={!item.flown && { opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{
                            opacity: 0,
                            transition: { duration: duration.fast },
                          }}
                          transition={{
                            opacity: { duration: duration.fast },
                            layout: layoutTransition,
                          }}
                        >
                          <motion.span
                            className={styles.chipSkin}
                            aria-hidden={'true'}
                            initial={
                              !reducedMotion && { opacity: 0, scale: 0.9 }
                            }
                            animate={{ opacity: 1, scale: 1 }}
                            transition={itemTransition}
                          />
                          <Avatar
                            entry={item.entry}
                            size={22}
                            layoutId={avatarLayoutId(item.entry.email)}
                          />
                          <motion.span
                            className={styles.chipBody}
                            initial={!reducedMotion && { opacity: 0, x: -4 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={
                              reducedMotion
                                ? { duration: 0 }
                                : {
                                    ...spring.smooth,
                                    delay: 0.08 * !!item.flown,
                                  }
                            }
                          >
                            <span
                              className={styles.chipLabel}
                              title={item.entry.email}
                            >
                              {label}
                            </span>
                            <button
                              type={'button'}
                              className={styles.role}
                              aria-haspopup={'menu'}
                              aria-expanded={menuOpen}
                              aria-label={`${label} · ${t('Role')} ${roleLabel(item.role)}`}
                              data-open={menuOpen || undefined}
                              onClick={(event) =>
                                openRoleMenu(item.key, event.currentTarget)
                              }
                              onKeyDown={(event) => {
                                if (!('ArrowDown' !== event.key || menuOpen)) {
                                  event.preventDefault();
                                  openRoleMenu(item.key, event.currentTarget);
                                }
                              }}
                            >
                              <AutoWidth>
                                <Swap id={item.role}>
                                  {roleLabel(item.role)}
                                </Swap>
                              </AutoWidth>
                              <ChevronDown
                                size={12}
                                strokeWidth={1.75}
                                aria-hidden={'true'}
                              />
                            </button>
                            <button
                              type={'button'}
                              className={styles.chipRemove}
                              aria-label={`${t('Remove')} ${label}`}
                              onClick={() => removeChip(item.key, label)}
                            >
                              <X
                                size={14}
                                strokeWidth={1.75}
                                aria-hidden={'true'}
                              />
                            </button>
                          </motion.span>
                        </motion.li>
                      );
                    })}
                  </AnimatePresence>
                  <motion.li
                    layout={'position'}
                    transition={{ layout: layoutTransition }}
                    className={styles.inputItem}
                  >
                    <input
                      ref={inputRef}
                      className={styles.input}
                      type={'text'}
                      role={'combobox'}
                      aria-label={t('Emails or names')}
                      aria-expanded={showSuggestions}
                      aria-controls={suggestionListId}
                      aria-autocomplete={'list'}
                      aria-activedescendant={
                        showSuggestions && activeSuggestion >= 0
                          ? `${suggestionListId}-${activeSuggestion}`
                          : undefined
                      }
                      aria-describedby={hintId}
                      placeholder={
                        selected.length
                          ? t('Add more')
                          : (props.placeholder ??
                            `Name or email, like emma@${domain}`)
                      }
                      value={query}
                      disabled={props.disabled}
                      autoComplete={'off'}
                      spellCheck={false}
                      onChange={(event) => {
                        setQuery(event.target.value);
                        setNavigated(true);
                        setHighlightIndex(0);
                        setSuggestionsClosed(false);
                        setBackspaceArmed(false);
                      }}
                      onKeyDown={(event) => {
                        if (event.nativeEvent.isComposing) return;
                        if (
                          'ArrowDown' === event.key ||
                          'ArrowUp' === event.key
                        ) {
                          event.preventDefault();
                          if (!showSuggestions) {
                            setSuggestionsClosed(false);
                            return;
                          }
                          const selectableIndices = suggestions
                            .map((item, index) =>
                              'blocked' === item.kind ? -1 : index,
                            )
                            .filter((item) => item >= 0);
                          if (!selectableIndices.length) return;
                          const currentIndex =
                            selectableIndices.indexOf(activeSuggestion);
                          const direction = event.key === 'ArrowDown' ? 1 : -1;
                          setNavigated(true);
                          setHighlightIndex(
                            selectableIndices[
                              (currentIndex +
                                direction +
                                selectableIndices.length) %
                                selectableIndices.length
                            ],
                          );
                        } else if ('Enter' === event.key) {
                          event.preventDefault();
                          let suggestion =
                            showSuggestions && activeSuggestion >= 0
                              ? suggestions[activeSuggestion]
                              : undefined;
                          if (
                            suggestion &&
                            (query.trim() || 'person' === suggestion.kind)
                          ) {
                            addSuggestion(suggestion);
                            return;
                          }
                          if (query.trim()) {
                            addTokens(query);
                            setQuery('');
                          }
                        } else if (
                          (',' === event.key || ';' === event.key) &&
                          query.trim()
                        ) {
                          event.preventDefault();
                          addTokens(query);
                          setQuery('');
                        } else if (
                          'Backspace' === event.key &&
                          !query &&
                          selected.length
                        ) {
                          let lastSelected = selected[selected.length - 1];
                          if (backspaceArmed) {
                            removeChip(
                              lastSelected.key,
                              'ok' === lastSelected.kind
                                ? (lastSelected.entry.name ??
                                    lastSelected.entry.email)
                                : lastSelected.text,
                            );
                          } else {
                            setBackspaceArmed(true);
                            setAnnouncement(
                              `Press backspace again to remove ${'ok' === lastSelected.kind ? (lastSelected.entry.name ?? lastSelected.entry.email) : lastSelected.text}`,
                            );
                          }
                        } else if ('Escape' === event.key) {
                          if (showSuggestions) {
                            event.preventDefault();
                            event.stopPropagation();
                            setSuggestionsClosed(true);
                          } else if (query) {
                            event.preventDefault();
                            event.stopPropagation();
                            setQuery('');
                          }
                        }
                      }}
                      onPaste={(event) => {
                        let pastedText = event.clipboardData.getData('text');
                        if (splitList(pastedText).length >= 2) {
                          event.preventDefault();
                          addTokens(pastedText);
                        }
                      }}
                      onFocus={() => {
                        setFocused(true);
                        setSuggestionsClosed(false);
                      }}
                      onBlur={() => {
                        setFocused(false);
                        setBackspaceArmed(false);
                      }}
                    />
                  </motion.li>
                </ul>
              </div>
            </AutoHeight>
            <AnimatePresence>
              {showSuggestions && (
                <motion.div
                  key={'list'}
                  className={styles.popover}
                  onPointerDown={(event) => event.preventDefault()}
                  initial={
                    reducedMotion
                      ? { opacity: 0 }
                      : { opacity: 0, y: -4, scale: 0.98 }
                  }
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={
                    reducedMotion
                      ? { opacity: 0 }
                      : {
                          opacity: 0,
                          y: -4,
                          scale: 0.98,
                          transition: { duration: duration.fast },
                        }
                  }
                  transition={
                    reducedMotion
                      ? { duration: duration.instant }
                      : spring.snappy
                  }
                >
                  {!query.trim() && (
                    <p className={styles.popHeading}>{t('Suggested')}</p>
                  )}
                  <ul
                    id={suggestionListId}
                    className={styles.options}
                    role={'listbox'}
                    aria-label={t('Suggestions')}
                  >
                    {suggestions.map((item, index) => (
                      <motion.li
                        key={item.id}
                        id={`${suggestionListId}-${index}`}
                        role={'option'}
                        aria-selected={index === activeSuggestion}
                        aria-disabled={'blocked' === item.kind || undefined}
                        className={styles.option}
                        data-kind={item.kind}
                        layout={'position'}
                        transition={{ layout: layoutTransition }}
                        onPointerMove={() => {
                          navigated && setNavigated(false);
                          'blocked' !== item.kind &&
                            index !== activeSuggestion &&
                            setHighlightIndex(index);
                        }}
                        onClick={() => addSuggestion(item)}
                      >
                        {index === activeSuggestion && (
                          <motion.span
                            layoutId={`${instanceId}-highlight`}
                            className={styles.optionHighlight}
                            transition={
                              reducedMotion || navigated
                                ? { duration: 0 }
                                : spring.morph
                            }
                            aria-hidden={'true'}
                          />
                        )}
                        {'email' === item.kind ? (
                          <span
                            className={classNames(
                              styles.avatar,
                              styles.mailAvatar,
                            )}
                            style={{ width: 30, height: 30 }}
                          >
                            <Mail
                              size={15}
                              strokeWidth={1.75}
                              aria-hidden={'true'}
                            />
                          </span>
                        ) : (
                          <Avatar
                            entry={item.entry}
                            size={30}
                            layoutId={
                              'person' === item.kind
                                ? avatarLayoutId(item.entry.email)
                                : undefined
                            }
                          />
                        )}
                        <span className={styles.optionText}>
                          <span className={styles.optionName}>
                            {'email' === item.kind
                              ? item.entry.email
                              : item.entry.name}
                          </span>
                          <span className={styles.optionEmail}>
                            {'email' === item.kind
                              ? t('Invite by email')
                              : item.entry.email}
                          </span>
                        </span>
                        {'email' !== item.kind && (
                          <span className={styles.optionNote}>{t(item.note)}</span>
                        )}
                      </motion.li>
                    ))}
                  </ul>
                  {!suggestions.length && (
                    <p className={styles.popEmpty}>
                      {t('No one matches “')}
                      {query.trim()}
                      {t('”. Type a full email to invite them.')}
                    </p>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <div className={styles.hintRow}>
            <p id={hintId} className={styles.hint}>
              <Swap id={hint ?? 'default'}>
                {hint ? t(hint) : t('Separate with commas, or paste a whole list')}
              </Swap>
            </p>
            {props.sampleList !== false && (
              <button
                type={'button'}
                className={styles.textButton}
                onClick={() => addTokens(props.sampleList ?? inviteSampleList)}
              >
                <ClipboardPaste {...iconProps} size={14} />
                {'Paste a sample list'}
              </button>
            )}
          </div>
          <AnimatePresence initial={false}>
            {invalidSelected.length > 0 && (
              <Collapse key={'errors'}>
                <div id={errorsId} className={styles.errors}>
                  <div className={styles.errorsHead}>
                    <span className={styles.errorsTitle}>
                      <CircleAlert {...iconProps} />
                      <AutoWidth>
                        <Swap id={String(invalidSelected.length)}>
                          {plural(invalidSelected.length, 'entry', 'entries')}
                          {t(' can’t be invited')}
                        </Swap>
                      </AutoWidth>
                    </span>
                    <button
                      type={'button'}
                      className={styles.textButton}
                      onClick={() => {
                        setSelected((previousSelected) =>
                          previousSelected.filter((item) => 'ok' === item.kind),
                        );
                        setAnnouncement(
                          `Removed ${plural(invalidSelected.length, 'entry', 'entries')}`,
                        );
                      }}
                    >
                      {t('Remove invalid')}
                    </button>
                  </div>
                  <ul className={styles.errorList}>
                    <AnimatePresence initial={false}>
                      {invalidSelected.map((item) => (
                        <motion.li
                          key={item.key}
                          className={styles.collapse}
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={
                            reducedMotion
                              ? { duration: 0 }
                              : {
                                  height: spring.smooth,
                                  opacity: { duration: duration.fast },
                                }
                          }
                        >
                          <span className={styles.errorLine}>
                            {t(item.message)}
                          </span>
                        </motion.li>
                      ))}
                    </AnimatePresence>
                  </ul>
                  <p className={styles.errorsFoot}>
                    {t('Select an entry to fix it')}
                  </p>
                </div>
              </Collapse>
            )}
          </AnimatePresence>
          {props.showSeats !== false && <div className={styles.seats} id={seatsId}>
            <div className={styles.seatsHead}>
              <span
                className={styles.seatsCount}
                data-over={overLimit > 0 || undefined}
              >
                <span className={styles.num}>
                  <AnimatedCounter value={totalSeats} />
                </span>
                <span className={styles.seatsOf}>{'of'}</span>
                <span className={styles.num}>
                  <AnimatedCounter value={seatLimit} />
                </span>
                <span className={styles.seatsOf}>{'seats'}</span>
              </span>
              <span className={styles.plan}>
                <Swap id={plan}>
                  {(plans[plan] ?? { name: 'Plan', seats: 0 }).name}
                  {' plan'}
                </Swap>
              </span>
            </div>
            <div
              className={styles.track}
              role={'meter'}
              aria-label={'Seats'}
              aria-valuemin={0}
              aria-valuemax={seatLimit}
              aria-valuenow={Math.min(totalSeats, seatLimit)}
              aria-valuetext={`${totalSeats} of ${seatLimit} seats${overLimit ? `, ${overLimit} over the limit` : ''}`}
            >
              <motion.span
                className={styles.segment}
                data-kind={overLimit ? 'over' : 'new'}
                initial={false}
                animate={{ width: seatPercentage(totalSeats) }}
                transition={heightTransition}
              />
              <motion.span
                className={styles.segment}
                data-kind={'pending'}
                data-edge={selectedCount > 0 || undefined}
                initial={false}
                animate={{ width: seatPercentage(memberCount + pendingCount) }}
                transition={heightTransition}
              />
              <motion.span
                className={styles.segment}
                data-kind={'members'}
                data-edge={pendingCount + selectedCount > 0 || undefined}
                initial={false}
                animate={{ width: seatPercentage(memberCount) }}
                transition={heightTransition}
              />
            </div>
            <ul className={styles.legend} aria-hidden={'true'}>
              <li>
                <span className={styles.swatch} data-kind={'members'} />
                {plural(memberCount, 'member')}
              </li>
              <li>
                <span className={styles.swatch} data-kind={'pending'} />
                {pendingCount}
                {' pending'}
              </li>
              <li>
                <span
                  className={styles.swatch}
                  data-kind={overLimit ? 'over' : 'new'}
                />
                {selectedCount}
                {' new'}
              </li>
            </ul>
            <AnimatePresence initial={false}>
              {overLimit > 0 && (
                <Collapse key={'over'}>
                  <motion.div
                    className={styles.over}
                    animate={{
                      x:
                        reducedMotion || !seatShake
                          ? 0
                          : shakeFrames[seatShake % 2],
                    }}
                    transition={{ duration: 0.42, ease: 'easeOut' }}
                  >
                    <CircleAlert {...iconProps} />
                    <span className={styles.overText}>
                      <AutoWidth>
                        <Swap id={String(overLimit)}>
                          {plural(overLimit, 'seat')}
                          {' over'}
                        </Swap>
                      </AutoWidth>
                      {' the '}
                      {(plans[plan] ?? { name: 'Plan', seats: 0 }).name}
                      {' plan'}
                    </span>
                    {'starter' === plan && plans.team ? (
                      <button
                        type="button"
                        className={styles.ghost}
                        onClick={() => {
                          state.upgradePlan('team');
                        }}
                      >
                        {'Upgrade to Team'}
                      </button>
                    ) : (
                      <span className={styles.overHelp}>
                        {'Remove people to send'}
                      </span>
                    )}
                  </motion.div>
                </Collapse>
              )}
            </AnimatePresence>
          </div>}
          {operationError && (
            <div className={styles.errors} role="alert">
              <p className={styles.errorLine}>{t(operationError)}</p>
            </div>
          )}
          {props.configurationSlot && (
            <div className="invite-people-configuration">
              {typeof props.configurationSlot === 'function'
                ? props.configurationSlot({ selected, pending, sending })
                : props.configurationSlot}
            </div>
          )}
          <footer className={styles.footer}>
            {props.footerSlot}
            <div className={styles.footerActions}>
              <button
                type={'button'}
                className={styles.iconButton}
                onClick={() => {
                  state.reset();
                  setQuery('');
                  setRoleMenu(null);
                  setHint(null);
                  setBackspaceArmed(false);
                  setAnnouncement('Preview reset');
                }}
                aria-label={t('Reset preview')}
                title={t('Reset preview')}
              >
                <RotateCcw {...iconProps} />
              </button>
              <button
                type={'button'}
                className={styles.send}
                onClick={() => {
                  if (props.disabled || props.sendDisabled || sending) return;
                  if (!selectedCount) {
                    return void inputRef.current?.focus();
                  }
                  if (invalidSelected.length) {
                    setChipShake((previousChipShake) => previousChipShake + 1);
                    setAnnouncement(
                      `Fix or remove ${plural(invalidSelected.length, 'entry', 'entries')} before sending`,
                    );
                    return;
                  }
                  if (overLimit) {
                    setSeatShake((previousSeatShake) => previousSeatShake + 1);
                    setAnnouncement(
                      `${plural(overLimit, 'seat')} over the ${(plans[plan] ?? { name: 'Plan', seats: 0 }).name} plan. Upgrade or remove people to send.`,
                    );
                    return;
                  }
                  setRoleMenu(null);
                  setQuery('');
                  state.sendInvites(validSelected);
                }}
                aria-disabled={sendBlocked || undefined}
                aria-describedby={
                  invalidSelected.length
                    ? errorsId
                    : overLimit
                      ? seatsId
                      : undefined
                }
                aria-label={
                  selectedCount
                    ? `${t('Send invites')} ${selectedCount}`
                    : t('Send invites')
                }
              >
                <Send {...iconProps} />
                <span className={styles.sendLabel} aria-hidden={'true'}>
                  {t('Send')}
                  <motion.span
                    className={styles.sendCount}
                    initial={false}
                    animate={{
                      width: selectedCount ? 'auto' : 0,
                      opacity: +!!selectedCount,
                    }}
                    transition={reducedMotion ? { duration: 0 } : spring.morph}
                  >
                    <span className={styles.num}>
                      <AnimatedCounter value={Math.max(1, selectedCount)} />
                    </span>
                  </motion.span>
                  <AutoWidth className={styles.sendWord}>
                    <Swap id={1 === selectedCount ? 'one' : 'many'}>
                      {t(1 === selectedCount ? 'invite' : 'invites')}
                    </Swap>
                  </AutoWidth>
                </span>
              </button>
            </div>
          </footer>
          <section className={styles.pending} aria-labelledby={pendingId}>
            <h3
              id={pendingId}
              ref={pendingHeadingRef}
              tabIndex={-1}
              className={styles.pendingHead}
            >
              {t('Pending ')}
              <span className={styles.pendingCount}>
                <span className={styles.num}>
                  <AnimatedCounter value={pendingCount} />
                </span>
              </span>
            </h3>
            <ul className={styles.rows}>
              <AnimatePresence initial={false}>
                {pending.map((item) => {
                  let label = item.entry.name ?? item.entry.email,
                    wasResent = !!resent[item.key],
                    busy = !!rowOperations[item.key];
                  return (
                    <motion.li
                      key={item.key}
                      className={styles.row}
                      initial={{ height: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={
                        reducedMotion
                          ? { duration: 0 }
                          : {
                              height: spring.smooth,
                              opacity: { duration: duration.fast },
                            }
                      }
                    >
                      <div className={styles.rowInner}>
                        <Avatar
                          entry={item.entry}
                          size={36}
                          layoutId={avatarLayoutId(item.entry.email)}
                        />
                        <motion.div
                          className={styles.rowText}
                          initial={!reducedMotion && { opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{
                            duration: duration.standard,
                            delay: 0.12,
                          }}
                        >
                          <span className={styles.rowName}>{label}</span>
                          <span className={styles.rowMeta}>
                            {roleLabel(item.role)}
                            {item.entry.name ? ` \xb7 ${item.entry.email}` : ''}
                          </span>
                        </motion.div>
                        <motion.span
                          className={styles.status}
                          data-status={item.status}
                          initial={!reducedMotion && { opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{
                            duration: duration.standard,
                            delay: 0.12,
                          }}
                        >
                          <AutoWidth>
                            <Swap id={item.status + item.note}>
                              <span className={styles.statusInner}>
                                {'sending' === item.status && (
                                  <LoaderCircle
                                    className={styles.spin}
                                    size={13}
                                    strokeWidth={1.75}
                                    aria-hidden={'true'}
                                  />
                                )}
                                {'joined' === item.status && (
                                  <Check
                                    size={13}
                                    strokeWidth={2}
                                    aria-hidden={'true'}
                                  />
                                )}
                                {t(item.note)}
                              </span>
                            </Swap>
                          </AutoWidth>
                        </motion.span>
                        <motion.div
                          className={styles.rowActions}
                          data-hidden={'joined' === item.status || undefined}
                          initial={!reducedMotion && { opacity: 0 }}
                          animate={{ opacity: +('joined' !== item.status) }}
                          transition={{
                            duration:
                              'joined' === item.status
                                ? duration.fast
                                : duration.standard,
                            delay: 0.12 * ('joined' !== item.status),
                          }}
                        >
                          {props.canResend !== false && <button
                            type={'button'}
                            className={styles.textButton}
                            onClick={() => {
                              if (!wasResent && !busy) state.resendInvite(item);
                            }}
                            disabled={
                              'sent' !== item.status || busy || props.disabled
                            }
                            aria-disabled={wasResent || busy || undefined}
                            aria-label={
                              wasResent
                                ? `Invite sent again to ${label}`
                                : `Resend invite to ${label}`
                            }
                          >
                            <span className={styles.stack}>
                              <span data-on={!wasResent || undefined}>
                                {'Resend'}
                              </span>
                              <span data-on={wasResent || undefined}>
                                <Check
                                  size={13}
                                  strokeWidth={2}
                                  aria-hidden={'true'}
                                />
                                {'Sent again'}
                              </span>
                            </span>
                          </button>}
                          <button
                            type={'button'}
                            className={styles.iconButton}
                            data-size={'sm'}
                            onClick={async () => {
                              if (await state.revokeInvite(item)) {
                                pendingHeadingRef.current?.focus({
                                  preventScroll: true,
                                });
                              }
                            }}
                            disabled={
                              'sent' !== item.status || busy || props.disabled
                            }
                            aria-label={`${t('Revoke invite')} ${label}`}
                            title={t('Revoke invite')}
                          >
                            <X
                              size={15}
                              strokeWidth={1.75}
                              aria-hidden={'true'}
                            />
                          </button>
                        </motion.div>
                      </div>
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ul>
            <AnimatePresence initial={false}>
              {0 === pending.length && (
                <Collapse key={'empty'}>
                  <p className={styles.empty}>{t('No pending invites')}</p>
                </Collapse>
              )}
            </AnimatePresence>
          </section>
          <AnimatePresence>
            {roleMenu && roleSelection && (
              <motion.div
                key={'menu'}
                ref={roleMenuRef}
                className={styles.menu}
                role={'menu'}
                aria-label={`${roleSelection.entry.name ?? roleSelection.entry.email} · ${t('Role')}`}
                style={{ left: roleMenu.x, top: roleMenu.y }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    closeRoleMenu(true);
                    return;
                  }
                  let menuItems = Array.from(
                      event.currentTarget.querySelectorAll(
                        '[role="menuitemradio"]:not(:disabled)',
                      ),
                    ),
                    currentIndex = menuItems.indexOf(document.activeElement),
                    focusMenuItem = (index) => {
                      event.preventDefault();
                      menuItems[
                        (index + menuItems.length) % menuItems.length
                      ]?.focus();
                    };
                  'ArrowDown' === event.key
                    ? focusMenuItem(currentIndex + 1)
                    : 'ArrowUp' === event.key
                      ? focusMenuItem(currentIndex - 1)
                      : 'Home' === event.key
                        ? focusMenuItem(0)
                        : 'End' === event.key
                          ? focusMenuItem(menuItems.length - 1)
                          : 'Tab' === event.key && setRoleMenu(null);
                }}
                initial={
                  reducedMotion
                    ? { opacity: 0 }
                    : { opacity: 0, y: -4, scale: 0.97 }
                }
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={
                  reducedMotion
                    ? { opacity: 0, transition: { duration: 0 } }
                    : {
                        opacity: 0,
                        y: -4,
                        scale: 0.97,
                        transition: { duration: duration.fast },
                      }
                }
                transition={
                  reducedMotion ? { duration: duration.instant } : spring.snappy
                }
              >
                {roles.map((item) => (
                  <button
                    key={item.value}
                    type={'button'}
                    role={'menuitemradio'}
                    aria-checked={roleSelection.role === item.value}
                    disabled={item.disabled}
                    className={styles.menuItem}
                    onPointerMove={(event) => {
                      if (document.activeElement !== event.currentTarget) {
                        event.currentTarget.focus({ preventScroll: true });
                      }
                    }}
                    onClick={() => {
                      if (!roleSelection) return;
                      const role = item.value;
                      setSelected((previousSelected) =>
                        previousSelected.map((item2) =>
                          item2.key === roleSelection.key && 'ok' === item2.kind
                            ? { ...item2, role: role }
                            : item2,
                        ),
                      );
                      setAnnouncement(
                        `${roleSelection.entry.name ?? roleSelection.entry.email} will join as ${roleLabel(role).toLowerCase()}`,
                      );
                      closeRoleMenu(true);
                    }}
                  >
                    <span className={styles.menuLabel}>{item.label}</span>
                    <span className={styles.menuDescription}>
                      {item.description}
                    </span>
                    {roleSelection.role === item.value && (
                      <Check
                        className={styles.menuCheck}
                        size={15}
                        strokeWidth={2}
                        aria-hidden={'true'}
                      />
                    )}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
          <p className={styles.srOnly} aria-live={'polite'}>
            {t(announcement)}
          </p>
        </section>
      </LayoutGroup>
    </MotionConfig>
  );
}
export {
  InvitePeopleRuntime,
  inviteRoles,
  inviteDirectory,
  inviteTeam,
  invitePlans,
  makeDemoPending,
  splitList,
};
