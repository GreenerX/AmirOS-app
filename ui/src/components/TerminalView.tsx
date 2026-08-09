import { Check, Copy, RefreshCw, Search, TerminalSquare } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TerminalStreamStatus } from "../api";
import type { DashboardData, TerminalLog } from "../types";
import { formatTime } from "../format";
import { WhatsAppIcon } from "./BrandIcons";

type TerminalViewProps = {
  connection: DashboardData["connection"];
  loadLog: () => Promise<TerminalLog>;
  subscribeLog: (handlers: {
    onLog: (log: TerminalLog) => void;
    onHeartbeat: (checkedAt: number) => void;
    onStatus: (status: TerminalStreamStatus) => void;
  }) => () => void;
};

export function TerminalView({ connection, loadLog, subscribeLog }: TerminalViewProps) {
  const [log, setLog] = useState<TerminalLog>({ output: "Loading AmirOS output…", updatedAt: 0 });
  const [error, setError] = useState<string>();
  const [autoScroll, setAutoScroll] = useState(true);
  const [streamStatus, setStreamStatus] = useState<TerminalStreamStatus>("connecting");
  const [checkedAt, setCheckedAt] = useState(0);
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState(false);
  const outputRef = useRef<HTMLPreElement>(null);
  const displayedOutput = useMemo(() => {
    if (error) return `Unable to load output: ${error}`;
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return log.output;
    const lines = log.output.split("\n").filter((line) => line.toLocaleLowerCase().includes(needle));
    return lines.length ? lines.join("\n") : `No terminal lines match “${query.trim()}”.`;
  }, [error, log.output, query]);

  const refresh = useCallback(async () => {
    try {
      setLog(await loadLog());
      setCheckedAt(Date.now());
      setError(undefined);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not read the AmirOS log");
    }
  }, [loadLog]);

  useEffect(() => {
    void refresh();
    const unsubscribe = subscribeLog({
      onLog: (nextLog) => { setLog(nextLog); setError(undefined); },
      onHeartbeat: setCheckedAt,
      onStatus: setStreamStatus,
    });
    const fallback = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 10_000);
    return () => { unsubscribe(); window.clearInterval(fallback); };
  }, [refresh, subscribeLog]);

  useEffect(() => {
    if (!autoScroll || !outputRef.current) return;
    outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [autoScroll, log.output]);

  return (
    <main className="main-content secondary-page terminal-page">
      <header className="page-header compact-header">
        <div><h1>Terminal</h1><p>Live output from the detached AmirOS background process.</p></div>
        <button className="button secondary" onClick={() => void refresh()}><RefreshCw size={17} />Refresh</button>
      </header>
      <section className="terminal-shell" aria-label="AmirOS background terminal">
        <div className="terminal-toolbar">
          <span className="terminal-title"><TerminalSquare size={17} />AmirOS · background</span>
          <span className={`terminal-connection ${connection.status}`}><WhatsAppIcon size={15} />{connection.status === "ready" ? "WhatsApp ready" : connection.detail}</span>
          <label className="terminal-search"><Search size={14} /><input aria-label="Filter terminal output" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter output" /></label>
          <label><input type="checkbox" checked={autoScroll} onChange={(event) => setAutoScroll(event.target.checked)} />Follow output</label>
          <button className="terminal-copy" type="button" onClick={() => void navigator.clipboard.writeText(displayedOutput).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1_500); })}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? "Copied" : "Copy"}</button>
        </div>
        <pre ref={outputRef} tabIndex={0}>{displayedOutput}</pre>
        <footer>
          <span>Read-only · secrets are redacted</span>
          <span className={`terminal-stream-status ${streamStatus}`}><span className="terminal-stream-dot" />{streamStatus === "live" ? `Live · checked ${checkedAt ? formatTime(checkedAt) : "now"}` : streamStatus === "reconnecting" ? "Reconnecting…" : "Connecting…"}</span>
          <span>{log.updatedAt ? `Output changed ${formatTime(log.updatedAt)}` : "Waiting for output"}</span>
        </footer>
      </section>
    </main>
  );
}
