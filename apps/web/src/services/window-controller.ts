import {
  AppError,
  assertOperationConditions,
  type OperationCondition,
  errorCode,
  normalizeHostWindowRequest,
  type HostWindowObservation,
  type HostWindowPort,
  type HostWindowRequest,
  type HostWindowSnapshot,
  type HostWindowState,
} from "@read-aware/core";
import {
  ObservationCauses,
  causalActor,
  copyEventCause,
  stampEventCause,
  type DomainActor,
} from "../platform/domain-actor";

export type WindowViewport = { width: number; height: number };

export type WindowAdapter = {
  supported(): boolean;
  read(): Promise<HostWindowState & { viewport?: WindowViewport; inputRevision?: number | null }>;
  inputRevision?(): Promise<number | null>;
  apply(request: HostWindowRequest, signal?: AbortSignal): Promise<void>;
  watch(changed: () => void): Promise<() => void>;
};

function requestedState(state: HostWindowSnapshot | undefined, request: HostWindowRequest): boolean {
  return (
    !!state?.supported &&
    (request.action === "fullscreen"
      ? state.fullscreen === request.enabled
      : request.action === "maximize"
        ? state.maximized && !state.minimized
        : request.action === "minimize"
          ? state.minimized
          : !state.minimized && !state.maximized && !state.fullscreen)
  );
}

/** Main-window intents only. A native acknowledgement is not an animation receipt. */
export class HostWindowService implements HostWindowPort {
  private tail: Promise<unknown> = Promise.resolve();
  private queued = 0;
  private revision = 0;
  private previous = "";
  private observed?: HostWindowSnapshot;
  private viewport: WindowViewport | null = null;
  private commandRevision = 0;
  private inputRevision: number | null = null;
  private layoutCommand?: { revision: number; origin: DomainActor };
  private reading?: Promise<HostWindowSnapshot>;
  private listeners = new Set<(source?: object) => void>();
  private stopWatch?: () => void;
  private watchGeneration = 0;

  constructor(
    private adapter: WindowAdapter,
    private report: (error: unknown) => void,
  ) {}

  private capacityConditions(): OperationCondition[] {
    return [
      {
        kind: "capacity",
        state: this.queued >= 32 ? "unavailable" : "satisfied",
        reason: this.queued >= 32 ? "window-queue-full" : "window-queue-available",
        errorCode: "ui/unavailable",
      },
    ];
  }

  private platformConditions(): OperationCondition[] {
    const supported = this.adapter.supported();
    return [
      {
        kind: "provider",
        state: supported ? "satisfied" : "unavailable",
        reason: supported ? "desktop-window-supported" : "desktop-window-unsupported",
        errorCode: "ui/unavailable",
      },
    ];
  }

  /** Read only; the result is a snapshot, never a reservation or OS receipt. */
  async conditions(input: HostWindowRequest, signal?: AbortSignal): Promise<OperationCondition[]> {
    const request = normalizeHostWindowRequest(input);
    signal?.throwIfAborted();
    const conditions = [...this.platformConditions(), ...this.capacityConditions()];
    if (conditions.some((value) => value.state === "unavailable")) return conditions;
    try {
      const state = await this.snapshot(signal);
      return [
        ...this.platformConditions(),
        ...this.capacityConditions(),
        {
          kind: "input",
          state: "satisfied",
          reason: requestedState(state, request) ? "window-already-in-requested-state" : "window-change-required",
        },
      ];
    } catch (error) {
      signal?.throwIfAborted();
      this.report(error);
      return [
        ...this.platformConditions(),
        ...this.capacityConditions(),
        { kind: "object", state: "unknown", reason: "window-state-read-failed", errorCode: "ui/unavailable" },
      ];
    }
  }

  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    try {
      assertOperationConditions(this.capacityConditions());
    } catch (error) {
      return Promise.reject(error);
    }
    this.queued++;
    const result = this.tail.then(run).finally(() => {
      this.queued--;
    });
    this.tail = result.catch(() => {}); // Failure must not poison later independent intents.
    return result;
  }

  private async read(origin?: DomainActor): Promise<HostWindowSnapshot> {
    const native = this.adapter.supported() ? await this.adapter.read() : null;
    // Geometry is host-private. The public window contract exposes no sizes or
    // platform fields, and read receipts do not claim animation completion.
    const state = native
      ? {
          supported: true as const,
          minimized: native.minimized,
          maximized: native.maximized,
          fullscreen: native.fullscreen,
          focused: native.focused,
        }
      : { supported: false as const };
    const viewport = native?.viewport;
    const command = this.layoutCommand;
    const inputChanged = native?.inputRevision != null && native.inputRevision !== this.inputRevision;
    this.inputRevision = native?.inputRevision ?? null;
    if (this.layoutCommand && this.layoutCommand.revision !== this.inputRevision) this.layoutCommand = undefined;
    const source = causalActor(
      command && command.revision !== this.inputRevision
        ? "system"
        : (origin ?? this.layoutCommand?.origin ?? "system"),
    );
    if (
      viewport &&
      Number.isFinite(viewport.width) &&
      Number.isFinite(viewport.height) &&
      viewport.width > 0 &&
      viewport.height > 0
    ) {
      if (inputChanged || viewport.width !== this.viewport?.width || viewport.height !== this.viewport?.height) {
        this.viewport = stampEventCause({ width: viewport.width, height: viewport.height }, source);
      }
    } else this.viewport = null;
    const key = JSON.stringify(state);
    if (key !== this.previous) {
      this.previous = key;
      this.revision++;
      this.observed = stampEventCause({ ...state, revision: this.revision }, source);
    }
    return copyEventCause(this.observed!, { ...this.observed! });
  }

  async snapshot(signal?: AbortSignal): Promise<HostWindowSnapshot> {
    signal?.throwIfAborted();
    if (!this.reading) {
      const read = this.enqueue(() => this.read());
      this.reading = read;
      void read
        .finally(() => {
          if (this.reading === read) this.reading = undefined;
        })
        .catch(() => {}); // Caller receives the read failure.
    }
    const value = await this.reading;
    signal?.throwIfAborted();
    return copyEventCause(value, { ...value });
  }

  control(input: HostWindowRequest, signal?: AbortSignal, origin: DomainActor = "system") {
    const request = normalizeHostWindowRequest(input);
    origin = causalActor(origin);
    signal?.throwIfAborted();
    this.commandRevision++;
    return this.enqueue(async () => {
      signal?.throwIfAborted();
      assertOperationConditions(this.platformConditions());
      // Establish an unclaimed baseline before dispatch. A no-op request must
      // not relabel old state or geometry as an effect of the caller.
      await this.read();
      signal?.throwIfAborted();
      const unchanged = requestedState(this.observed, request);
      // A no-op cannot replace an earlier effect's source. New native input
      // invalidates this association; acknowledgement or elapsed time does not.
      if (!unchanged)
        this.layoutCommand = this.inputRevision === null ? undefined : { revision: this.inputRevision, origin };
      try {
        try {
          await this.adapter.apply(request, signal);
        } catch (error) {
          // Restore can fail after an earlier native step succeeded. Preserve
          // that observed effect even though the caller receives a failure.
          try {
            await this.read(origin);
          } catch (readError) {
            this.report(readError);
          }
          throw error;
        }
        const snapshot = await this.read(origin);
        signal?.throwIfAborted();
        return { status: "requested" as const, snapshot };
      } finally {
        this.notify(stampEventCause({}, origin));
      }
    });
  }

  private notify = (source?: object) => {
    for (const listener of this.listeners) listener(source);
  };

  observe(handler: (value: HostWindowObservation) => unknown, origin: DomainActor = "system"): () => void {
    if (typeof handler !== "function") throw new AppError("ui/invalid-target", "Expected window observer");
    if (this.listeners.size >= 64) throw new AppError("ui/observer-limit", "Too many window observers");
    let stopped = false,
      running = false,
      dirty = false,
      last = "";
    const causes = new ObservationCauses();
    causes.add(stampEventCause({}, causalActor(origin)));
    let retained: object | undefined;
    const deliver = async () => {
      dirty = true;
      if (running || stopped) return;
      running = true;
      try {
        do {
          dirty = false;
          let value: HostWindowObservation;
          try {
            const snapshot = await this.snapshot();
            value = copyEventCause(snapshot, { status: "ready", snapshot });
          } catch (error) {
            this.report(error);
            value = { status: "error", code: errorCode(error) ?? "ipc/unknown" };
          }
          if (stopped) return;
          if (dirty) continue;
          const key = JSON.stringify(value);
          // Native polling is not a new root. Use the observed state's source
          // after the initial subscription, retaining failed delivery causes.
          if (last && value.status === "ready") causes.add(value);
          const event = causes.take(value, retained);
          retained = value.status === "error" ? copyEventCause(event, {}) : undefined;
          if (!stopped && key !== last) {
            try {
              await handler(event);
              last = key;
            } catch (error) {
              retained = copyEventCause(event, {});
              this.report(error);
            }
          }
        } while (dirty && !stopped);
      } finally {
        running = false;
      }
    };
    const notify = (source?: object) => {
      if (source) causes.add(source);
      void deliver();
    };
    this.listeners.add(notify);
    if (this.listeners.size === 1 && this.adapter.supported()) {
      const generation = ++this.watchGeneration;
      void this.adapter
        .watch(() => this.notify())
        .then((stop) => {
          if (generation !== this.watchGeneration || !this.listeners.size) stop();
          else {
            this.stopWatch = stop;
            this.notify();
          }
        })
        .catch((error) => this.report(error));
    }
    notify();
    return () => {
      if (stopped) return;
      stopped = true;
      this.listeners.delete(notify);
      if (!this.listeners.size) {
        this.watchGeneration++;
        this.stopWatch?.();
        this.stopWatch = undefined;
      }
    };
  }
}
