import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { readTimeFormat, saveTimeFormat, type TimeFormat } from "./time-format";

type TimeFormatContextValue = {
  timeFormat: TimeFormat;
  setTimeFormat: (value: TimeFormat) => void;
};

const TimeFormatContext = createContext<TimeFormatContextValue | undefined>(undefined);

export function TimeFormatProvider({ children }: { children: ReactNode }) {
  const [timeFormat, setStoredTimeFormat] = useState<TimeFormat>(readTimeFormat);
  const setTimeFormat = useCallback((value: TimeFormat) => {
    saveTimeFormat(value);
    setStoredTimeFormat(value);
  }, []);
  const context = useMemo(() => ({ timeFormat, setTimeFormat }), [setTimeFormat, timeFormat]);
  return <TimeFormatContext.Provider value={context}>{children}</TimeFormatContext.Provider>;
}

export function useTimeFormat(): TimeFormatContextValue {
  const value = useContext(TimeFormatContext);
  if (!value) throw new Error("useTimeFormat must be used inside TimeFormatProvider");
  return value;
}
