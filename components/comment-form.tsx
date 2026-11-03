"use client";
import { useState } from "react";
import { human, type Note } from "@/lib/domain";
import { noteDefaults } from "@/lib/workflow";
export default function CommentForm({
  busy,
  save,
}: {
  busy: boolean;
  save: (kind: NonNullable<Note["kind"]>, body: string) => Promise<boolean>;
}) {
  const [kind, setKind] = useState<NonNullable<Note["kind"]>>("comentario");
  const [body, setBody] = useState<string>(noteDefaults.comentario);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (body.trim() && (await save(kind, body.trim())))
          setBody(noteDefaults[kind]);
      }}
    >
      <label>
        Tipo:
        <select
          aria-label="Tipo de comentario"
          value={kind}
          onChange={(e) => {
            const next = e.target.value as typeof kind;
            setKind(next);
            setBody(noteDefaults[next]);
          }}
        >
          {Object.keys(noteDefaults).map((k) => (
            <option key={k} value={k}>
              {human(k)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Comentario
        <textarea
          aria-label="Texto del comentario"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          required
          maxLength={10000}
          rows={5}
        />
      </label>
      <button className="primary" disabled={busy || !body.trim()}>
        Guardar comentario
      </button>
    </form>
  );
}
