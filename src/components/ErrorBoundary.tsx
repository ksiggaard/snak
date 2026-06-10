import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  info: ErrorInfo | null;
}

/**
 * Root error boundary. Without one, any render-time throw makes React unmount
 * the whole tree, leaving only the dark `bg-background` body — i.e. an all-black
 * window with no clue why. This catches the throw and renders the error +
 * component stack on screen so failures are diagnosable instead of silent.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Also log so it shows in the webview console / any attached logger.
    console.error("Render error caught by ErrorBoundary:", error, info);
    this.setState({ info });
  }

  render(): ReactNode {
    const { error, info } = this.state;
    if (!error) return this.props.children;
    return (
      <div
        style={{
          padding: "1.5rem",
          fontFamily: "monospace",
          fontSize: "13px",
          color: "#fafafa",
          background: "#1a1a1a",
          height: "100vh",
          overflow: "auto",
          whiteSpace: "pre-wrap",
        }}
      >
        <h1 style={{ fontSize: "16px", marginBottom: "0.75rem" }}>
          Something crashed while rendering
        </h1>
        <strong>{error.name}: {error.message}</strong>
        {"\n\n"}
        {error.stack}
        {info?.componentStack ? `\n\nComponent stack:${info.componentStack}` : ""}
      </div>
    );
  }
}
