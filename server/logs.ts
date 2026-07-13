export interface SystemLog {
  time: string;
  type: string;
  message: string;
}

const systemLogs: SystemLog[] = [];
const MAX = 300;

export function addLog(type: string, message: string) {
  systemLogs.push({
    time: new Date().toLocaleTimeString(),
    type,
    message,
  });
  if (systemLogs.length > MAX) systemLogs.shift();
  // Never log raw secrets — callers must redact
  console.log(`[${type}] ${message}`);
}

export function getLogs(): SystemLog[] {
  return [...systemLogs];
}
