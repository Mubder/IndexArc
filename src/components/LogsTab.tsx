import React from "react";
import { LogEntry } from "../types";

interface LogsTabProps {
  logs: LogEntry[];
}

export const LogsTab: React.FC<LogsTabProps> = ({ logs }) => {
  return (
    <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 font-mono text-[11px] max-h-[70vh] overflow-y-auto space-y-1">
      {logs.map((l, i) => (
        <div key={i} className="flex gap-2">
          <span className="text-slate-600 shrink-0">{l.time}</span>
          <span className="text-indigo-400 shrink-0 w-16">{l.type}</span>
          <span className="text-slate-300">{l.message}</span>
        </div>
      ))}
      {!logs.length && <p className="text-slate-500">No logs yet.</p>}
    </div>
  );
};
