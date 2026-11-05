import type { Application, Note } from "@/lib/domain";
import {
  followUp,
  hasScheduledFollowUp,
  dateOnly,
  uyDay,
} from "@/lib/workflow";
export default function FollowUp({
  app,
  notes,
  now,
  banner = false,
}: {
  app: Application;
  notes: Note[];
  now?: number;
  banner?: boolean;
}) {
  const level = followUp(app, notes, now);
  if (hasScheduledFollowUp(app))
    return (
      <span
        role="status"
        className={`${banner ? "followup-banner" : "followup-chip"} ${level === "urgente" ? "urgent" : ""}`}
      >
        {app.follow_up_date! < uyDay(now ?? Date.now())
          ? "Seguimiento vencido"
          : app.follow_up_date === uyDay(now ?? Date.now())
            ? "Seguimiento hoy"
            : "Seguimiento programado"}{" "}
        · {dateOnly(app.follow_up_date!)}
      </span>
    );
  return level ? (
    <span
      role="status"
      className={`${banner ? "followup-banner" : "followup-chip"} ${level === "urgente" ? "urgent" : ""}`}
    >
      Seguimiento {level}
    </span>
  ) : null;
}
