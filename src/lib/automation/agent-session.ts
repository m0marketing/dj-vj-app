export class AgentRequestError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

type AgentRequest = (path: string, body?: unknown, method?: string, signal?: AbortSignal) => Promise<unknown>;

/** Running sessions reject DELETE with 409 until cancellation has finished. */
export async function deleteAgentSession(
  request: AgentRequest,
  path: string,
  wait: () => Promise<void> = () => new Promise((resolve) => setTimeout(resolve, 500)),
) {
  const signal = AbortSignal.timeout(20000);
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      await request(path, undefined, "DELETE", signal);
      return;
    } catch (error) {
      // A previous deletion may have succeeded even if its response was lost.
      if (error instanceof AgentRequestError && error.status === 404) return;
      if (!(error instanceof AgentRequestError) || error.status !== 409) throw error;
    }
    if (attempt === 0) {
      try {
        await request(`${path}/events`, { events: [{ type: "agent.session.input.cancel" }] }, "POST", signal);
      } catch (error) {
        if (error instanceof AgentRequestError && error.status === 404) return;
        throw error;
      }
    }
    await wait();
  }
  throw new Error("Agentsの停止を待っています。セッション情報は保持されています。少し待ってから「停止・セッション削除」を再実行してください。");
}
