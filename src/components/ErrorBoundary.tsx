import { Component, type ErrorInfo, type ReactNode } from "react";
import { ShieldAlert } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error in AuditHound Studio:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div style={{
          height: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#1e1e1e",
          color: "#ffffff",
          fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
          padding: "20px",
          textAlign: "center"
        }}>
          <ShieldAlert size={48} color="#ff453a" style={{ marginBottom: "16px" }} />
          <h2 style={{ fontSize: "18px", fontWeight: 600, marginBottom: "8px" }}>Something went wrong</h2>
          <p style={{ fontSize: "13px", color: "rgba(255, 255, 255, 0.55)", maxWidth: "400px", marginBottom: "20px" }}>
            The UI encountered an unexpected error. You can try refreshing the page.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              backgroundColor: "#0a84ff",
              color: "#ffffff",
              border: "none",
              borderRadius: "6px",
              padding: "8px 16px",
              fontSize: "12px",
              fontWeight: 600,
              cursor: "pointer"
            }}
          >
            Reload application
          </button>
          {this.state.error && (
            <pre style={{
              marginTop: "24px",
              padding: "12px",
              backgroundColor: "#151515",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              borderRadius: "6px",
              fontSize: "11px",
              fontFamily: "monospace",
              color: "#ff453a",
              maxWidth: "600px",
              overflowX: "auto",
              textAlign: "left"
            }}>
              {this.state.error.toString()}
            </pre>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
