"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  saveAssessmentDraftAction,
  type AssessmentDraftConflictSnapshot
} from "@/app/worker/(portal)/assessments/[attemptId]/actions";
import type {
  AssessmentAttemptClientDraft,
  AssessmentAttemptClientQuestion
} from "@/lib/assessment-attempt/assessment-attempt-domain";

type SaveRequest = Readonly<{
  editVersion: number;
  value: string;
  expectedRevision: number | null;
  mutationKey: string;
}>;

type TransmissionOutcome = "saved" | "conflict" | "error" | "transport" | "busy";

export type AssessmentDraftAutosaveConflict = Readonly<{
  message: string;
  serverDraft: AssessmentDraftConflictSnapshot | null;
}>;

export type AssessmentDraftAutosaveState = Readonly<{
  value: string;
  setValue: (value: string) => void;
  saveStatus: string;
  conflict: AssessmentDraftAutosaveConflict | null;
  useSavedVersion: () => void;
  replaceSavedVersion: () => void;
  flushExactCurrentEdit: () => Promise<boolean>;
  bestEffortCurrentEdit: () => Promise<void>;
}>;

const DEBOUNCE_MS = 500;
const RETRY_MS = 1_500;
export const EMERGENCY_EXIT_TIMEOUT_MS = 900;

function initialEditValue(draft: AssessmentAttemptClientDraft | null): string {
  if (draft?.value === true) return "true";
  if (draft?.value === false) return "false";
  return typeof draft?.value === "string" ? draft.value : "";
}

function draftPayload(
  questionType: AssessmentAttemptClientQuestion["questionType"],
  value: string
): unknown {
  if (questionType === "TRUE_FALSE") {
    if (value === "true") return true;
    if (value === "false") return false;
    return null;
  }
  if (questionType === "MULTIPLE_CHOICE") {
    return value.length === 0 ? null : value;
  }
  return value;
}

function mutationKey(editVersion: number): string {
  return `m208-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${editVersion}`;
}

export function useAssessmentDraftAutosave(input: {
  question: AssessmentAttemptClientQuestion;
  initialDraft: AssessmentAttemptClientDraft | null;
}): AssessmentDraftAutosaveState {
  const { question, initialDraft } = input;
  const [value, setValueState] = useState(() => initialEditValue(initialDraft));
  const [saveStatus, setSaveStatus] = useState(initialDraft === null ? "Ready" : "Saved");
  const [conflict, setConflict] = useState<AssessmentDraftAutosaveConflict | null>(null);

  const currentValueRef = useRef(value);
  const revisionRef = useRef<number | null>(initialDraft?.revision ?? null);
  const editVersionRef = useRef(0);
  const acknowledgedEditVersionRef = useRef(initialDraft === null ? -1 : 0);
  const inFlightRef = useRef<SaveRequest | null>(null);
  const idleWaitersRef = useRef<Array<() => void>>([]);
  const retryPendingRef = useRef(false);
  const retryRequestRef = useRef<SaveRequest | null>(null);
  const conflictRef = useRef<AssessmentDraftAutosaveConflict | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const sendRequestRef = useRef<(request: SaveRequest) => void>(() => undefined);

  const clearDebounce = useCallback(() => {
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }, []);

  const clearRetry = useCallback(() => {
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const makeRequest = useCallback(
    (
      requestValue: string,
      editVersion: number,
      expectedRevision: number | null = revisionRef.current
    ): SaveRequest =>
      Object.freeze({
        editVersion,
        value: requestValue,
        expectedRevision,
        mutationKey: mutationKey(editVersion)
      }),
    []
  );

  const waitUntilIdle = useCallback(async (): Promise<boolean> => {
    if (inFlightRef.current === null) return mountedRef.current;
    await new Promise<void>((resolve) => {
      idleWaitersRef.current.push(resolve);
    });
    return mountedRef.current;
  }, []);

  const queueLatest = useCallback(
    (delay = DEBOUNCE_MS) => {
      clearDebounce();
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        if (
          !mountedRef.current ||
          inFlightRef.current !== null ||
          retryPendingRef.current ||
          conflictRef.current !== null
        ) {
          return;
        }
        const request = makeRequest(currentValueRef.current, editVersionRef.current);
        sendRequestRef.current(request);
      }, delay);
    },
    [clearDebounce, makeRequest]
  );

  const transmit = useCallback(
    async (request: SaveRequest): Promise<TransmissionOutcome> => {
      if (!mountedRef.current || inFlightRef.current !== null) return "busy";
      inFlightRef.current = request;
      clearRetry();

      const formData = new FormData();
      formData.set("attemptId", question.attemptId);
      formData.set("position", String(question.position));
      formData.set("questionVersionId", question.questionVersionId);
      formData.set("draftPayload", JSON.stringify(draftPayload(question.questionType, request.value)));
      formData.set(
        "expectedRevision",
        request.expectedRevision === null ? "" : String(request.expectedRevision)
      );
      formData.set("clientGeneratedMutationKey", request.mutationKey);

      try {
        const result = await saveAssessmentDraftAction(formData);
        if (!mountedRef.current) return "error";

        if (result.status === "saved") {
          retryPendingRef.current = false;
          retryRequestRef.current = null;
          revisionRef.current = result.revision;
          if (editVersionRef.current === request.editVersion) {
            acknowledgedEditVersionRef.current = request.editVersion;
            setSaveStatus("Saved");
          } else {
            setSaveStatus("Saving…");
          }
          return "saved";
        }

        if (result.status === "conflict") {
          retryPendingRef.current = false;
          retryRequestRef.current = null;
          const nextConflict = Object.freeze({
            message: result.message,
            serverDraft: result.serverDraft
          });
          conflictRef.current = nextConflict;
          setConflict(nextConflict);
          setSaveStatus("Conflict");
          return "conflict";
        }

        retryPendingRef.current = false;
        retryRequestRef.current = null;
        setSaveStatus(result.message);
        return "error";
      } catch {
        if (!mountedRef.current) return "transport";
        retryPendingRef.current = true;
        retryRequestRef.current = request;
        setSaveStatus("Not saved — reconnecting");
        retryTimerRef.current = setTimeout(() => {
          retryTimerRef.current = null;
          if (!mountedRef.current) return;
          retryPendingRef.current = false;
          retryRequestRef.current = null;
          sendRequestRef.current(request);
        }, RETRY_MS);
        return "transport";
      } finally {
        inFlightRef.current = null;
        for (const resolve of idleWaitersRef.current.splice(0)) resolve();
        if (
          mountedRef.current &&
          !retryPendingRef.current &&
          conflictRef.current === null &&
          editVersionRef.current !== request.editVersion
        ) {
          queueLatest(0);
        }
      }
    },
    [clearRetry, queueLatest, question]
  );

  useEffect(() => {
    sendRequestRef.current = (request: SaveRequest) => {
      void transmit(request);
    };
  }, [transmit]);

  const setValue = useCallback(
    (nextValue: string) => {
      currentValueRef.current = nextValue;
      editVersionRef.current += 1;
      conflictRef.current = null;
      setConflict(null);
      setValueState(nextValue);
      setSaveStatus("Saving…");
      queueLatest();
    },
    [queueLatest]
  );

  const useSavedVersion = useCallback(() => {
    const serverDraft = conflictRef.current?.serverDraft;
    if (!serverDraft) return;
    clearDebounce();
    clearRetry();
    retryPendingRef.current = false;
    retryRequestRef.current = null;
    revisionRef.current = serverDraft.revision;
    const savedValue =
      serverDraft.value === true
        ? "true"
        : serverDraft.value === false
          ? "false"
          : typeof serverDraft.value === "string"
            ? serverDraft.value
            : "";
    currentValueRef.current = savedValue;
    editVersionRef.current += 1;
    acknowledgedEditVersionRef.current = editVersionRef.current;
    conflictRef.current = null;
    setConflict(null);
    setValueState(savedValue);
    setSaveStatus("Saved");
  }, [clearDebounce, clearRetry]);

  const replaceSavedVersion = useCallback(() => {
    const serverDraft = conflictRef.current?.serverDraft;
    if (!serverDraft || inFlightRef.current !== null) return;
    clearDebounce();
    clearRetry();
    retryPendingRef.current = false;
    retryRequestRef.current = null;
    revisionRef.current = serverDraft.revision;
    conflictRef.current = null;
    setConflict(null);
    setSaveStatus("Saving…");
    const request = makeRequest(
      currentValueRef.current,
      editVersionRef.current,
      serverDraft.revision
    );
    sendRequestRef.current(request);
  }, [clearDebounce, clearRetry, makeRequest]);

  const flushExactCurrentEdit = useCallback(async (): Promise<boolean> => {
    clearDebounce();

    if (!(await waitUntilIdle()) || conflictRef.current !== null) return false;

    if (retryPendingRef.current && retryRequestRef.current !== null) {
      const retryRequest = retryRequestRef.current;
      clearRetry();
      retryPendingRef.current = false;
      retryRequestRef.current = null;
      const retryOutcome = await transmit(retryRequest);
      if (retryOutcome !== "saved") return false;
      if (!(await waitUntilIdle()) || conflictRef.current !== null) return false;
    }

    const targetEditVersion = editVersionRef.current;
    if (acknowledgedEditVersionRef.current === targetEditVersion) return true;

    setSaveStatus("Saving…");
    const request = makeRequest(currentValueRef.current, targetEditVersion);
    const outcome = await transmit(request);
    if (outcome !== "saved") return false;
    if (editVersionRef.current !== targetEditVersion) return false;
    if (acknowledgedEditVersionRef.current !== targetEditVersion) return false;
    return true;
  }, [clearDebounce, clearRetry, makeRequest, transmit, waitUntilIdle]);

  const bestEffortCurrentEdit = useCallback(async (): Promise<void> => {
    await Promise.race([
      flushExactCurrentEdit(),
      new Promise<boolean>((resolve) => {
        setTimeout(() => resolve(false), EMERGENCY_EXIT_TIMEOUT_MS);
      })
    ]);
  }, [flushExactCurrentEdit]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearDebounce();
      clearRetry();
      for (const resolve of idleWaitersRef.current.splice(0)) resolve();
    };
  }, [clearDebounce, clearRetry]);

  return {
    value,
    setValue,
    saveStatus,
    conflict,
    useSavedVersion,
    replaceSavedVersion,
    flushExactCurrentEdit,
    bestEffortCurrentEdit
  };
}
