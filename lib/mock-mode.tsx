"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import type { AgentRunRecord } from "./agent-runs";
import {
  emitMockStoreChanged,
  isMockModeEnabled,
  readMockRunRecord,
  readMockRunRecords,
  setMockModeEnabled,
  subscribeToMockStore,
} from "./mock-store";

// React state that tracks:
//   1. Whether mock mode is currently enabled (toggled by Mission Control)
//   2. The current snapshot of mock records in localStorage
//   3. Whether the client has finished hydrating — before that, the hybrid
//      wrappers render their server fallback to avoid a hydration mismatch.
//
// Mutations go through mock-store helpers which emit a change event; the
// provider re-reads on every change so every consumer stays in sync.

type MockModeState = {
  ready: boolean;
  enabled: boolean;
  records: AgentRunRecord[];
};

type MockModeContextValue = MockModeState & {
  setEnabled: (enabled: boolean) => void;
  refresh: () => void;
};

const MockModeContext = createContext<MockModeContextValue | null>(null);

export function MockModeProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<MockModeState>({
    ready: false,
    enabled: false,
    records: [],
  });

  const refresh = useCallback(() => {
    setState({
      ready: true,
      enabled: isMockModeEnabled(),
      records: readMockRunRecords(),
    });
  }, []);

  useEffect(() => {
    refresh();
    const unsubscribe = subscribeToMockStore(refresh);
    return unsubscribe;
  }, [refresh]);

  const setEnabled = useCallback(
    (enabled: boolean) => {
      setMockModeEnabled(enabled);
      emitMockStoreChanged();
    },
    [],
  );

  return (
    <MockModeContext.Provider value={{ ...state, setEnabled, refresh }}>
      {children}
    </MockModeContext.Provider>
  );
}

export function useMockMode(): MockModeContextValue {
  const ctx = useContext(MockModeContext);
  if (!ctx) {
    // Safe fallback so components don't crash when used outside the provider
    // (e.g. in a Storybook-style isolated render). Mock mode just reads off.
    return {
      ready: true,
      enabled: false,
      records: [],
      setEnabled: () => {},
      refresh: () => {},
    };
  }
  return ctx;
}

// Convenience reader for a single record. The context holds the full
// records array; this is just sugar over `records.find`.
export function useMockRun(runId: string): AgentRunRecord | null {
  const { records } = useMockMode();
  return records.find(record => record.id === runId) ?? readMockRunRecord(runId);
}
