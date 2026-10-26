/** The replayable part of one run's Server-Sent Events stream. */
export interface StreamListener { write(chunk: string): unknown }
export interface Run {
  events: unknown[];
  listeners: Set<StreamListener>;
  done: boolean;
  /** Latest numeric snapshot, replacing earlier stages until the final result. */
  partial?: unknown;
  result?: unknown;
  error?: string;
}

function encode(data: unknown, event = "message"): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function publishRun(run: Run, data: unknown, event: "message" | "partial" | "result" | "failure" = "message"): void {
  if (event === "partial") run.partial = data;
  const line = encode(data, event);
  for (const listener of run.listeners) listener.write(line);
  if (event === "result" || event === "failure") {
    run.listeners.clear();
    delete run.partial;
  }
}

export function subscribeRun(run: Run, listener: StreamListener): () => void {
  for (const event of run.events) listener.write(encode(event));
  if (run.done) {
    listener.write(run.error ? encode({ error: run.error }, "failure") : encode(run.result, "result"));
    return () => {};
  }
  if (run.partial !== undefined) listener.write(encode(run.partial, "partial"));
  run.listeners.add(listener);
  return () => { run.listeners.delete(listener); };
}
