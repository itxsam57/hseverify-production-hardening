"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type MediaRole = "worker" | "assessor";
type SignalKind = "offer" | "answer" | "ice" | "leave";
type RecordingPolicy = "VIDEO_AUDIO" | "AUDIO_ONLY" | "NOTES_ONLY" | "PROHIBITED";

type MediaSignal = {
  signalId: string;
  kind: SignalKind;
  payload: Record<string, unknown>;
  createdAt: string;
};

type MediaPollResponse = {
  role: MediaRole;
  status: "ASSIGNED" | "WAITING_ROOM" | "COMPLETED";
  scheduledAt: string;
  iceServers: RTCIceServer[];
  signals: MediaSignal[];
};

function connectionIdFrom(payload: Record<string, unknown>): string | null {
  return typeof payload.connectionId === "string" ? payload.connectionId : null;
}

export function LiveInterviewMedia({
  interviewRequestId,
  role,
  enabled = true,
  recordingPolicy = "NOTES_ONLY",
  recordingEnabled = false,
  recordingRetentionDays = 30
}: {
  interviewRequestId: string;
  role: MediaRole;
  enabled?: boolean;
  recordingPolicy?: RecordingPolicy;
  recordingEnabled?: boolean;
  recordingRetentionDays?: number;
}): React.JSX.Element {
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const seenSignalsRef = useRef(new Set<string>());
  const connectionIdRef = useRef<string | null>(null);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const processingRef = useRef(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingSegmentStartedAtRef = useRef<string | null>(null);

  const [consent, setConsent] = useState(false);
  const [status, setStatus] = useState("Not connected");
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [microphoneEnabled, setMicrophoneEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [recordingStatus, setRecordingStatus] = useState("Not recording");

  const sendSignal = useCallback(
    async (kind: SignalKind, payload: Record<string, unknown>): Promise<void> => {
      const response = await fetch(
        `/api/interviews/${encodeURIComponent(interviewRequestId)}/media`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind, payload }),
          cache: "no-store"
        }
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Interview media signaling failed.");
      }
    },
    [interviewRequestId]
  );


  const uploadRecordingSegment = useCallback(
    async (blob: Blob, startedAt: string, endedAt: string): Promise<void> => {
      if (blob.size < 1 || recordingPolicy === "NOTES_ONLY" || recordingPolicy === "PROHIBITED") {
        return;
      }
      const source = recordingPolicy === "AUDIO_ONLY" ? "AUDIO_ONLY" : "VIDEO_AUDIO";
      const response = await fetch(
        `/api/interviews/${encodeURIComponent(interviewRequestId)}/recording`,
        {
          method: "POST",
          headers: {
            "content-type":
              blob.type ||
              (recordingPolicy === "AUDIO_ONLY" ? "audio/webm" : "video/webm"),
            "x-recording-source": source,
            "x-recording-segment-key": crypto.randomUUID().replaceAll("-", ""),
            "x-recording-started-at": startedAt,
            "x-recording-ended-at": endedAt
          },
          body: blob,
          cache: "no-store"
        }
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Interview recording segment could not be stored.");
      }
    },
    [interviewRequestId, recordingPolicy]
  );

  const stopRecording = useCallback((): void => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        // Browser may already be closing the recorder.
      }
    }
    recorderRef.current = null;
    recordingStreamRef.current = null;
    recordingSegmentStartedAtRef.current = null;
    setRecordingStatus("Not recording");
  }, []);

  const startRecording = useCallback((): void => {
    if (
      !recordingEnabled ||
      recordingPolicy === "NOTES_ONLY" ||
      recordingPolicy === "PROHIBITED" ||
      recorderRef.current ||
      !localStreamRef.current
    ) {
      return;
    }
    if (typeof MediaRecorder === "undefined") {
      setError("This browser cannot record the interview required by the case policy.");
      setRecordingStatus("Recording unavailable");
      return;
    }

    const sourceStream =
      recordingPolicy === "AUDIO_ONLY"
        ? new MediaStream(localStreamRef.current.getAudioTracks())
        : localStreamRef.current;
    if (
      (recordingPolicy === "AUDIO_ONLY" && sourceStream.getAudioTracks().length === 0) ||
      (recordingPolicy === "VIDEO_AUDIO" && sourceStream.getTracks().length === 0)
    ) {
      setError("Required interview recording source is unavailable.");
      setRecordingStatus("Recording unavailable");
      return;
    }

    try {
      const preferred = recordingPolicy === "AUDIO_ONLY" ? "audio/webm" : "video/webm";
      const recorder = MediaRecorder.isTypeSupported(preferred)
        ? new MediaRecorder(sourceStream, { mimeType: preferred })
        : new MediaRecorder(sourceStream);
      recorderRef.current = recorder;
      recordingStreamRef.current = sourceStream;
      recordingSegmentStartedAtRef.current = new Date().toISOString();
      recorder.addEventListener("dataavailable", (event) => {
        const endedAt = new Date().toISOString();
        const startedAt = recordingSegmentStartedAtRef.current ?? endedAt;
        recordingSegmentStartedAtRef.current = endedAt;
        void uploadRecordingSegment(event.data, startedAt, endedAt)
          .then(() => setRecordingStatus("Recording active — latest segment stored"))
          .catch((uploadError) => {
            setRecordingStatus("Recording storage failed");
            setError(
              uploadError instanceof Error
                ? uploadError.message
                : "Interview recording storage failed. Pause the interview and record a technical issue."
            );
          });
      });
      recorder.addEventListener("error", () => {
        setRecordingStatus("Recording failed");
        setError("Interview recording failed. Pause the interview and record a technical issue.");
      });
      recorder.start(60_000);
      setRecordingStatus(
        `${recordingPolicy === "AUDIO_ONLY" ? "Audio" : "Video/audio"} recording active`
      );
    } catch {
      setRecordingStatus("Recording failed");
      setError("Interview recording could not start. Pause the interview and record a technical issue.");
    }
  }, [recordingEnabled, recordingPolicy, uploadRecordingSegment]);

  const flushPendingIce = useCallback(async (): Promise<void> => {
    const peer = peerRef.current;
    if (!peer?.remoteDescription) return;
    const pending = pendingIceRef.current.splice(0);
    for (const candidate of pending) {
      await peer.addIceCandidate(candidate);
    }
  }, []);

  const handleSignals = useCallback(
    async (signals: MediaSignal[]): Promise<void> => {
      if (processingRef.current || !peerRef.current) return;
      processingRef.current = true;
      try {
        const fresh = signals.filter((signal) => !seenSignalsRef.current.has(signal.signalId));
        for (const signal of fresh) seenSignalsRef.current.add(signal.signalId);
        if (fresh.length === 0) return;

        const peer = peerRef.current;
        if (!peer) return;

        if (role === "worker") {
          const offers = fresh.filter((signal) => signal.kind === "offer");
          const offer = offers.at(-1);
          if (offer) {
            const connectionId = connectionIdFrom(offer.payload);
            if (
              connectionId &&
              offer.payload.type === "offer" &&
              typeof offer.payload.sdp === "string"
            ) {
              connectionIdRef.current = connectionId;
              pendingIceRef.current = [];
              await peer.setRemoteDescription({
                type: "offer",
                sdp: offer.payload.sdp
              });
              const answer = await peer.createAnswer();
              await peer.setLocalDescription(answer);
              await sendSignal("answer", {
                connectionId,
                type: "answer",
                sdp: answer.sdp ?? ""
              });
              setStatus("Connecting to assessor");
              await flushPendingIce();
            }
          }
        } else {
          const connectionId = connectionIdRef.current;
          const answers = fresh.filter(
            (signal) =>
              signal.kind === "answer" &&
              connectionIdFrom(signal.payload) === connectionId
          );
          const answer = answers.at(-1);
          if (
            answer &&
            answer.payload.type === "answer" &&
            typeof answer.payload.sdp === "string" &&
            peer.signalingState === "have-local-offer"
          ) {
            await peer.setRemoteDescription({
              type: "answer",
              sdp: answer.payload.sdp
            });
            setStatus("Connecting to worker");
            await flushPendingIce();
          }
        }

        const activeConnectionId = connectionIdRef.current;
        for (const signal of fresh) {
          if (connectionIdFrom(signal.payload) !== activeConnectionId) continue;
          if (signal.kind === "ice" && typeof signal.payload.candidate === "string") {
            const candidate: RTCIceCandidateInit = {
              candidate: signal.payload.candidate,
              sdpMid:
                typeof signal.payload.sdpMid === "string"
                  ? signal.payload.sdpMid
                  : null,
              sdpMLineIndex:
                typeof signal.payload.sdpMLineIndex === "number"
                  ? signal.payload.sdpMLineIndex
                  : null
            };
            if (peer.remoteDescription) await peer.addIceCandidate(candidate);
            else pendingIceRef.current.push(candidate);
          }
          if (signal.kind === "leave") {
            setStatus("Other participant left the interview");
          }
        }
      } finally {
        processingRef.current = false;
      }
    },
    [flushPendingIce, role, sendSignal]
  );

  const readSignals = useCallback(async (): Promise<MediaPollResponse> => {
    const response = await fetch(
      `/api/interviews/${encodeURIComponent(interviewRequestId)}/media`,
      { cache: "no-store" }
    );
    const body = (await response.json().catch(() => null)) as
      | (MediaPollResponse & { error?: string })
      | null;
    if (!response.ok || !body) {
      throw new Error(body?.error ?? "Interview media is unavailable.");
    }
    return body;
  }, [interviewRequestId]);

  const stopMedia = useCallback(
    async (notifyPeer: boolean): Promise<void> => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      const connectionId = connectionIdRef.current;
      if (notifyPeer && connectionId) {
        await sendSignal("leave", { connectionId }).catch(() => undefined);
      }
      stopRecording();
      peerRef.current?.close();
      peerRef.current = null;
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
      if (localVideoRef.current) localVideoRef.current.srcObject = null;
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
      pendingIceRef.current = [];
      connectionIdRef.current = null;
      setStarted(false);
      setStatus("Not connected");
    },
    [sendSignal, stopRecording]
  );

  const startMedia = useCallback(async (): Promise<void> => {
    if (!enabled || !consent || started) return;
    setError(null);
    setStatus("Checking interview access");

    try {
      const initial = await readSignals();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: { echoCancellation: true, noiseSuppression: true }
      });

      const peer = new RTCPeerConnection({ iceServers: initial.iceServers });
      peerRef.current = peer;
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      for (const track of stream.getTracks()) peer.addTrack(track, stream);

      peer.ontrack = (event) => {
        const [remoteStream] = event.streams;
        if (remoteVideoRef.current && remoteStream) {
          remoteVideoRef.current.srcObject = remoteStream;
        }
      };
      peer.onconnectionstatechange = () => {
        const state = peer.connectionState;
        if (state === "connected") setStatus("Live — encrypted peer connection");
        else if (state === "connecting" || state === "new") setStatus("Connecting");
        else if (state === "disconnected") setStatus("Connection interrupted — reconnecting");
        else if (state === "failed") setStatus("Connection failed — retry the interview media");
        else if (state === "closed") setStatus("Interview media ended");
      };
      peer.onicecandidate = (event) => {
        const connectionId = connectionIdRef.current;
        if (!event.candidate || !connectionId) return;
        const candidate = event.candidate.toJSON();
        void sendSignal("ice", {
          connectionId,
          candidate: candidate.candidate ?? "",
          sdpMid: candidate.sdpMid ?? null,
          sdpMLineIndex: candidate.sdpMLineIndex ?? null
        }).catch((signalError) => {
          setError(signalError instanceof Error ? signalError.message : "ICE signaling failed.");
        });
      };

      setStarted(true);
      if (role === "assessor") {
        const connectionId = crypto.randomUUID().replaceAll("-", "");
        connectionIdRef.current = connectionId;
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        await sendSignal("offer", {
          connectionId,
          type: "offer",
          sdp: offer.sdp ?? ""
        });
        setStatus("Waiting for worker to join");
      } else {
        setStatus("Waiting for assessor connection");
      }

      await handleSignals(initial.signals);
      pollTimerRef.current = setInterval(() => {
        void readSignals()
          .then((result) => handleSignals(result.signals))
          .catch((pollError) => {
            setError(
              pollError instanceof Error
                ? pollError.message
                : "Interview signaling was interrupted."
            );
          });
      }, 1000);
    } catch (startError) {
      await stopMedia(false);
      setError(
        startError instanceof Error
          ? startError.message
          : "Camera or microphone could not be started."
      );
    }
  }, [
    consent,
    enabled,
    handleSignals,
    readSignals,
    role,
    sendSignal,
    started,
    stopMedia
  ]);

  useEffect(() => {
    if (started && recordingEnabled) {
      startRecording();
      return;
    }
    stopRecording();
  }, [recordingEnabled, startRecording, started, stopRecording]);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      stopRecording();
      peerRef.current?.close();
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, [stopRecording]);

  function toggleMicrophone(): void {
    const tracks = localStreamRef.current?.getAudioTracks() ?? [];
    const next = !microphoneEnabled;
    for (const track of tracks) track.enabled = next;
    setMicrophoneEnabled(next);
  }

  function toggleCamera(): void {
    const tracks = localStreamRef.current?.getVideoTracks() ?? [];
    const next = !cameraEnabled;
    for (const track of tracks) track.enabled = next;
    setCameraEnabled(next);
  }

  return (
    <div className="interview-media-panel">
      <div className="interview-media-status" role="status" aria-live="polite">
        <strong>Live interview media</strong>
        <span>{status}</span>
      </div>

      <label className="interview-consent">
        <input
          type="checkbox"
          checked={consent}
          onChange={(event) => setConsent(event.target.checked)}
          disabled={started}
        />
        <span>
          I allow this browser to use my camera and microphone for the assigned interview.
          {recordingPolicy === "NOTES_ONLY" || recordingPolicy === "PROHIBITED"
            ? " This interview is not recorded by HSE Verify."
            : ` Recording is controlled by the case policy and stored privately for ${recordingRetentionDays} days unless a legal hold applies.`}
        </span>
      </label>

      <div className="interview-video-grid">
        <figure>
          <video ref={localVideoRef} autoPlay playsInline muted />
          <figcaption>Your camera</figcaption>
        </figure>
        <figure>
          <video ref={remoteVideoRef} autoPlay playsInline />
          <figcaption>{role === "worker" ? "Assessor" : "Worker"}</figcaption>
        </figure>
      </div>

      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {recordingPolicy !== "NOTES_ONLY" && recordingPolicy !== "PROHIBITED" ? (
        <p className="muted-copy" role="status">Recording: {recordingStatus}</p>
      ) : null}

      <div className="interview-media-actions">
        {!started ? (
          <button
            type="button"
            className="button button-primary"
            disabled={!enabled || !consent}
            onClick={() => void startMedia()}
          >
            Enable camera & microphone
          </button>
        ) : (
          <>
            <button type="button" className="button button-secondary" onClick={toggleMicrophone}>
              {microphoneEnabled ? "Mute microphone" : "Unmute microphone"}
            </button>
            <button type="button" className="button button-secondary" onClick={toggleCamera}>
              {cameraEnabled ? "Turn camera off" : "Turn camera on"}
            </button>
            <button
              type="button"
              className="button button-danger"
              onClick={() => void stopMedia(true)}
            >
              Leave media
            </button>
          </>
        )}
      </div>

      {!enabled ? (
        <p className="muted-copy">
          Live media opens only after the interview is scheduled and the waiting-room
          window is available.
        </p>
      ) : (
        <p className="muted-copy">
          Media is encrypted browser-to-browser with WebRTC. HSE Verify relays only
          bounded signaling metadata for this assigned interview.
        </p>
      )}
    </div>
  );
}
