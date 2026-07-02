/** Provider log/event message shapes (as relayed by the provider-proxy). */
export interface LogEntryMessage {
  name?: string;
  service?: string;
  message: string;
}

export interface K8sEventMessage {
  type?: string;
  reason?: string;
  note?: string;
  object?: { kind?: string; name?: string };
}

/** `{name,service,message}` -> `[service] message`. */
export function formatLog(entry: LogEntryMessage): string {
  const service = entry.service ?? (entry.name ? entry.name.split("-")[0] : "");
  return service ? `[${service}] ${entry.message}` : entry.message;
}

/** k8s event -> `[service] [type] [reason] [kind] note`. */
export function formatEvent(event: K8sEventMessage): string {
  const service = event.object?.name ? event.object.name.split("-")[0] : "";
  return `[${service}] [${event.type ?? ""}] [${event.reason ?? ""}] [${event.object?.kind ?? ""}] ${event.note ?? ""}`.trim();
}
