import React from "react";

interface State {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error("IndexArc crash:", error, info);
    try {
      localStorage.setItem(
        "indexarc-last-crash",
        JSON.stringify({ message: error?.message, stack: error?.stack, at: Date.now() })
      );
    } catch {}
  }

  componentDidMount() {
    const onError = (e: ErrorEvent) => {
      const err = e.error instanceof Error ? e.error : new Error(e.message || "Unknown error");
      this.setState({ error: err });
    };
    // Unhandled promise rejections (a failed background fetch, a dismissed
    // dialog, …) are logged but NOT fatal — treating every rejection as a
    // crash turned recoverable hiccups into full-screen failures.
    const onReject = (e: PromiseRejectionEvent) => {
      // eslint-disable-next-line no-console
      console.error("Unhandled rejection:", e.reason);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onReject);
    this._cleanup = () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onReject);
    };
  }

  componentWillUnmount() {
    this._cleanup?.();
  }

  private _cleanup?: () => void;

  render() {
    if (this.state.error) {
      const e = this.state.error;
      return (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 99999,
            background: "#0b0e14",
            color: "#fca5a5",
            fontFamily: "monospace",
            fontSize: 13,
            padding: 24,
            overflow: "auto",
            whiteSpace: "pre-wrap",
          }}
        >
          <div style={{ color: "#f87171", fontWeight: 700, marginBottom: 12, fontSize: 15 }}>
            ⚠ IndexArc crashed — please copy this text and send it:
          </div>
          <div style={{ color: "#e5e7eb" }}>{e.message}</div>
          <pre style={{ marginTop: 12, color: "#9ca3af" }}>{e.stack}</pre>
          <button
            onClick={() => this.setState({ error: null })}
            style={{
              marginTop: 16,
              padding: "8px 14px",
              background: "#1d4ed8",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              cursor: "pointer",
            }}
          >
            Try to recover
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
