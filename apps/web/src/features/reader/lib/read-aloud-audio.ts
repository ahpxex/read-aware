/**
 * Playback for provider-synthesized audio, over Web Audio: decode the
 * encoded bytes and play the buffer. No object URLs, no media elements —
 * nothing for a CSP to block, and cancel is a plain source.stop().
 */

let sharedContext: AudioContext | null = null;

function audioContext(): AudioContext {
  sharedContext ??= new AudioContext();
  return sharedContext;
}

export type AudioHandle = { cancel: () => void };

export function playAudioBytes(
  bytes: ArrayBuffer,
  callbacks: { onStart: () => void; onEnd: () => void; onError: (error: unknown) => void },
): AudioHandle {
  let cancelled = false;
  let source: AudioBufferSourceNode | null = null;

  const context = audioContext();
  context
    // decodeAudioData detaches its input; callers must hand over a copy if
    // they intend to reuse the bytes (the prefetch cache does).
    .decodeAudioData(bytes)
    .then(async (buffer) => {
      if (cancelled) return;
      await context.resume();
      if (cancelled) return;
      if (context.state !== "running") throw new Error("Audio context did not resume");
      source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.onended = () => {
        source?.disconnect();
        if (!cancelled) callbacks.onEnd();
      };
      source.start();
      callbacks.onStart();
    })
    .catch((error) => {
      if (!cancelled) {
        callbacks.onError(error);
      }
    });

  return {
    cancel: () => {
      cancelled = true;
      try {
        source?.stop();
      } catch {
        // Already ended.
      }
      source?.disconnect();
    },
  };
}
