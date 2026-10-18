"use client";

import { Component, type ReactNode } from "react";

interface Props {
  name: string;
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/** Keeps one panel's render error from taking the whole studio (and the audio) down. */
export default class PanelBoundary extends Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error(`[${this.props.name}]`, error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="panel flex flex-col gap-2 p-3 text-xs" role="alert">
        <div className="font-semibold text-rose-300">{this.props.name} の表示でエラーが起きました</div>
        <div className="truncate font-mono text-[10px] text-zinc-500">{this.state.error.message}</div>
        <div className="text-zinc-400">音は止まっていません。再試行しても直らない場合はページを再読み込みしてください。</div>
        <button className="btn btn-primary self-start" onClick={() => this.setState({ error: null })}>
          再試行
        </button>
      </div>
    );
  }
}
