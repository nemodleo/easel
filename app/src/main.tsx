// AI-generated with Claude Code, 2026-10-09, reviewed by Hyun Park
import { Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { Icon } from "./icons";
import { strings } from "./strings";
import { ToastHost } from "./ui";
import "./style.css";

/** A render error (for example a bad board.json) shows what broke instead of leaving a blank page */
class CrashScreen extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="loading" role="alert">
        <Icon name="warn" /> {strings.app.crashed} {this.state.error.message}
        <button onClick={() => location.reload()}>{strings.app.reload}</button>
      </div>
    );
  }
}

createRoot(document.getElementById("root")!).render(
  <CrashScreen>
    <ToastHost>
      <App />
    </ToastHost>
  </CrashScreen>,
);
