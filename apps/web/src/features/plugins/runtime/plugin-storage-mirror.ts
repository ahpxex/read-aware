/** Host snapshots form the base; locally pending writes must survive older snapshots. */
export class PluginStorageMirror {
  private base = new Map<string, string>();
  private readonly pending = new Map<number, { key: string; value: string | null }>();
  private nextId = 1;

  replace(entries: Record<string, string>): void {
    this.base = new Map(Object.entries(entries));
  }

  get(key: string): string | undefined {
    let value = this.base.get(key);
    for (const mutation of this.pending.values()) {
      if (mutation.key === key) value = mutation.value ?? undefined;
    }
    return value;
  }

  begin(key: string, value: string | null): number {
    const id = this.nextId++;
    this.pending.set(id, { key, value });
    return id;
  }

  settle(id: number): void {
    this.pending.delete(id);
  }
}
