import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  answerLastStand,
  fetchLastStandLeaderboard,
  startLastStand,
} from './api';
import {
  LastStandSubmitGate,
  advanceFromReveal,
  applyLastStandAnswer,
  beginLastStandStart,
  createLastStandState,
  lastStandAbsoluteDeadline,
  lastStandErrorMessage,
  lastStandSendFailed,
  lastStandStartFailed,
  lastStandStarted,
  parseAnswerResponse,
  parseLeaderboardResponse,
  parseStartResponse,
  recordSentAnswer,
  type LastStandLeaderboardResponse,
  type LastStandState,
} from './lastStandRun';

export type LeaderboardView =
  | { status: 'closed' }
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ready'; data: LastStandLeaderboardResponse };

function statusOf(error: unknown): number | undefined {
  return error instanceof ApiError ? error.status : undefined;
}

export function useLastStand() {
  const [state, setState] = useState<LastStandState>(createLastStandState);
  const [submitting, setSubmitting] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardView>({ status: 'closed' });
  const stateRef = useRef(state);
  stateRef.current = state;
  const gateRef = useRef(new LastStandSubmitGate());
  // Bumped whenever a run is started or abandoned: late responses of an old run are dropped.
  const runTokenRef = useRef(0);
  const boardTokenRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => {
    runTokenRef.current += 1;
    boardTokenRef.current += 1;
    controllerRef.current?.abort();
  }, []);

  const start = useCallback(() => {
    if (stateRef.current.stage === 'loading') return;
    runTokenRef.current += 1;
    const token = runTokenRef.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    gateRef.current = new LastStandSubmitGate();
    setSubmitting(false);
    setLeaderboard({ status: 'closed' });
    setState(beginLastStandStart());

    void startLastStand(controller.signal).then((raw) => {
      if (runTokenRef.current !== token) return;
      setState(lastStandStarted(parseStartResponse(raw), Date.now()));
    }).catch((error: unknown) => {
      if (runTokenRef.current !== token) return;
      setState((previous) => lastStandStartFailed(previous, lastStandErrorMessage('start', statusOf(error))));
    });
  }, []);

  /** One request per tap; an answer after the deadline is sent once as an expired submission. */
  const submit = useCallback((answer: string) => {
    const current = stateRef.current;
    if (current.stage !== 'round' || !current.runId) return;
    const submission = gateRef.current.begin(answer, Date.now(), {
      startedAtMs: current.roundStartedAtMs,
      deadlineAtMs: lastStandAbsoluteDeadline(current),
    });
    if (!submission) return;

    const token = runTokenRef.current;
    const runId = current.runId;
    setSubmitting(true);
    setState((previous) => recordSentAnswer(previous, submission.answer, submission.atMs));

    void answerLastStand(runId, { answer: submission.answer, atMs: submission.atMs }, controllerRef.current?.signal)
      .then((raw) => {
        if (runTokenRef.current !== token) return;
        const response = parseAnswerResponse(raw);
        gateRef.current.release();
        setSubmitting(false);
        setState((previous) => applyLastStandAnswer(previous, response, Date.now()));
      })
      .catch((error: unknown) => {
        if (runTokenRef.current !== token) return;
        gateRef.current.release();
        setSubmitting(false);
        setState((previous) => lastStandSendFailed(previous, lastStandErrorMessage('send', statusOf(error))));
      });
  }, []);

  const continueFromReveal = useCallback(() => {
    setState((previous) => advanceFromReveal(previous, Date.now()));
  }, []);

  const openLeaderboard = useCallback(() => {
    boardTokenRef.current += 1;
    const token = boardTokenRef.current;
    setLeaderboard({ status: 'loading' });
    void fetchLastStandLeaderboard(stateRef.current.dateKey ?? undefined).then((raw) => {
      if (boardTokenRef.current !== token) return;
      setLeaderboard({ status: 'ready', data: parseLeaderboardResponse(raw) });
    }).catch((error: unknown) => {
      if (boardTokenRef.current !== token) return;
      setLeaderboard({ status: 'error', error: lastStandErrorMessage('leaderboard', statusOf(error)) });
    });
  }, []);

  const closeLeaderboard = useCallback(() => {
    boardTokenRef.current += 1;
    setLeaderboard({ status: 'closed' });
  }, []);

  return {
    state,
    submitting,
    leaderboard,
    start,
    submit,
    continueFromReveal,
    openLeaderboard,
    closeLeaderboard,
  };
}
