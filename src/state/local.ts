import { atom, useAtom, type PrimitiveAtom } from "jotai";
import { useRef } from "react";

export function useLocalAtom<T>(initialValue: T) {
  const atomRef = useRef<PrimitiveAtom<T> | null>(null);
  const stateAtom = atomRef.current ?? (atomRef.current = atom(initialValue));
  return useAtom(stateAtom);
}
