const TRACE_EVENT_KINDS = new Set([
  "submitted",
  "running",
  "stage",
  "source",
  "warning",
  "feedback",
  "artifact",
  "completed",
  "partial",
  "failed",
]);

const TRACE_FINAL_STATUSES = new Set(["completed", "partial", "failed"]);

function boundedText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function eventId(value) {
  return boundedText(value, 100) || `event-${Date.now().toString(36)}`;
}

export function appendTraceEvent(activity, event) {
  if (!activity || !event) return false;
  const kind = TRACE_EVENT_KINDS.has(event.kind) ? event.kind : "running";
  const label = boundedText(event.label || kind, 160);
  const detail = boundedText(event.detail, 1000);
  const previous = activity.events?.at(-1);
  if (previous?.kind === kind && previous?.label === label && previous?.detail === detail) {
    return false;
  }
  activity.events = [
    ...(activity.events || []),
    {
      id: eventId(event.id),
      kind,
      label,
      detail,
      at: boundedText(event.at, 80) || new Date().toISOString(),
    },
  ].slice(-40);
  return true;
}

export function attachTraceArtifact(activity, artifact, event = {}) {
  if (!activity || !artifact?.id) return false;
  const normalized = {
    kind: boundedText(artifact.kind || "artifact", 40),
    id: boundedText(artifact.id, 120),
    label: boundedText(artifact.label || artifact.id, 160),
  };
  activity.artifacts = [
    normalized,
    ...(activity.artifacts || []).filter((item) => item.id !== normalized.id),
  ].slice(0, 12);
  appendTraceEvent(activity, {
    ...event,
    kind: "artifact",
    label: event.label || "结构化产物已写回",
    detail: event.detail || `${normalized.kind} · ${normalized.label}`,
  });
  if (activity.status === "submitted") activity.status = "running";
  activity.updatedAt = boundedText(event.at, 80) || new Date().toISOString();
  return true;
}

export function finalizeTrace(activity, result = {}) {
  if (!activity) return false;
  const status = TRACE_FINAL_STATUSES.has(result.status) ? result.status : "completed";
  const at = boundedText(result.at, 80) || new Date().toISOString();
  const summary = boundedText(result.summary, 2000);
  const error = boundedText(result.error, 2000);
  const outputRefs = Array.isArray(result.outputRefs)
    ? result.outputRefs.map((item) => boundedText(item, 500)).filter(Boolean).slice(0, 12)
    : [];
  const labels = {
    completed: "Session 已完成",
    partial: "Session 部分完成",
    failed: "Session 执行失败",
  };
  const changed =
    activity.status !== status ||
    activity.outcome?.summary !== summary ||
    activity.outcome?.error !== error ||
    JSON.stringify(activity.outcome?.outputRefs || []) !== JSON.stringify(outputRefs);

  activity.status = status;
  activity.startedAt = boundedText(activity.startedAt, 80) || boundedText(activity.createdAt, 80) || at;
  activity.completedAt = at;
  activity.outcome = {
    status,
    summary,
    outputRefs,
    error,
    completedAt: at,
  };
  appendTraceEvent(activity, {
    id: result.eventId,
    kind: status,
    label: boundedText(result.label, 160) || labels[status],
    detail: [summary, error, outputRefs.join(" · ")].filter(Boolean).join("\n"),
    at,
  });
  activity.updatedAt = at;
  return changed;
}

export function transitionTraceForBusy(activity, wasBusy, isBusy, event = {}) {
  if (!activity) return false;
  if (!wasBusy && isBusy && activity.status === "submitted") {
    const at = boundedText(event.at, 80) || new Date().toISOString();
    activity.status = "running";
    activity.startedAt = boundedText(activity.startedAt, 80) || at;
    appendTraceEvent(activity, {
      ...event,
      kind: "running",
      label: event.label || "Session 开始执行",
    });
    activity.updatedAt = at;
    return true;
  }
  if (wasBusy && !isBusy && ["submitted", "running"].includes(activity.status)) {
    return finalizeTrace(activity, {
      status: "completed",
      summary:
        event.detail ||
        (activity.artifacts?.length
          ? `已写回 ${activity.artifacts.length} 个结构化产物`
          : "本次没有结构化产物写回；可查看当前 Session 的文字结果。"),
      outputRefs: (activity.artifacts || []).map((item) => `${item.kind}:${item.id}`),
      label: event.label || "Session 执行结束",
      eventId: event.id,
      at: event.at,
    });
  }
  return false;
}
