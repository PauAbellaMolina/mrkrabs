"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useSyncExternalStore,
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

const SERVER_MOCK_MODE_SNAPSHOT: MockModeState = Object.freeze({
  ready: false,
  enabled: false,
  records: [],
});

const readClientSnapshot = (records: AgentRunRecord[]): string =>
  JSON.stringify(records);

export function MockModeProvider({ children }: { children: React.ReactNode }) {
  const snapshotRef = useRef<MockModeState>({
    ready: true,
    enabled: false,
    records: [],
  });
  const snapshotSignatureRef = useRef<string>("1|false|[]");

  const state = useSyncExternalStore(
    subscribeToMockStore,
    () => {
      const records = readMockRunRecords();
      const enabled = isMockModeEnabled();
      const signature = `${enabled ? 1 : 0}|${readClientSnapshot(records)}`;

      if (snapshotSignatureRef.current === signature) {
        return snapshotRef.current;
      }

      const next = {
        ready: true,
        enabled,
        records,
      };

      snapshotRef.current = next;
      snapshotSignatureRef.current = signature;
      return next;
    },
    () => SERVER_MOCK_MODE_SNAPSHOT,
  );

  const refresh = useCallback(() => {
    emitMockStoreChanged();
  }, []);

  const setEnabled = useCallback((enabled: boolean) => {
    setMockModeEnabled(enabled);
    emitMockStoreChanged();
  }, []);

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
