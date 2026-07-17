export interface SystemLog {
  time: string;
  type: string;
  message: string;
}

const systemLogs: SystemLog[] = [];
const MAX = 2000;

export function addLog(type: string, message: string) {
  const now = new Date();
  systemLogs.push({
    time: `${now.toLocaleDateString()} ${now.toLocaleTimeString()}`,
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
