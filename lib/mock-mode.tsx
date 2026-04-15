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

export function useMockRun(runId: string): AgentRunRecord | null {
  const { records } = useMockMode();
  return records.find(record => record.id === runId) ?? readMockRunRecord(runId);
}
