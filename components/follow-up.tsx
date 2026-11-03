import type { Application, Note } from "@/lib/domain";
import { followUp } from "@/lib/workflow";
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
  return level ? (
    <span
      role="status"
      className={`${banner ? "followup-banner" : "followup-chip"} ${level === "urgente" ? "urgent" : ""}`}
    >
      Seguimiento {level}
    </span>
  ) : null;
}
