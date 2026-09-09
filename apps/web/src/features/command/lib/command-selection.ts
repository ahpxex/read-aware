type SelectableCommand = { disabled?: boolean };

export function nextCommandIndex(items: readonly SelectableCommand[], current: number, direction: 1 | -1): number {
  const start = current < 0 || current >= items.length ? (direction === 1 ? -1 : 0) : current;
  for (let offset = 1; offset <= items.length; offset++) {
    const index = (start + offset * direction + items.length) % items.length;
    if (!items[index].disabled) return index;
  }
  return -1;
}

export function availableCommandIndex(items: readonly SelectableCommand[], current: number): number {
  return items[current] && !items[current].disabled ? current : nextCommandIndex(items, current, 1);
}
