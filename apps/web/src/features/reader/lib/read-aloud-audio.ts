/**
 * Playback for provider-synthesized audio, over Web Audio: decode the
 * encoded bytes and play the buffer. No object URLs, no media elements —
 * nothing for a CSP to block, and cancel is a plain source.stop().
 */

let sharedContext: AudioContext | null = null;

function audioContext(): AudioContext {
  sharedContext ??= new AudioContext();
  // A context created outside a user gesture starts suspended on some
  // engines; resume is idempotent and cheap.
  void sharedContext.resume().catch(() => {});
  return sharedContext;
}

export type AudioHandle = { cancel: () => void };

export function playAudioBytes(
  bytes: ArrayBuffer,
  callbacks: { onEnd: () => void; onError: (error: string) => void },
): AudioHandle {
  let cancelled = false;
  let source: AudioBufferSourceNode | null = null;

  const context = audioContext();
  context
    // decodeAudioData detaches its input; callers must hand over a copy if
    // they intend to reuse the bytes (the prefetch cache does).
    .decodeAudioData(bytes)
    .then((buffer) => {
      if (cancelled) return;
      source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.onended = () => {
        if (!cancelled) callbacks.onEnd();
      };
      source.start();
    })
    .catch((error) => {
      if (!cancelled) {
        callbacks.onError(
          error instanceof Error ? error.message : "audio decode failed",
        );
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
