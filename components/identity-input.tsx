"use client";
import { useRef } from "react";
const digits = (value: string) => value.replace(/\D/g, "");
function format(value: string) {
  const n = digits(value).slice(0, 8);
  if (n.length < 2) return n;
  return (
    n.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, ".") + "-" + n.slice(-1)
  );
}
export default function IdentityInput({
  initial = "",
  required = false,
}: {
  initial?: string | null;
  required?: boolean;
}) {
  const previous = useRef(format(initial || ""));
  return (
    <input
      name="national_id"
      inputMode="numeric"
      required={required}
      defaultValue={previous.current}
      onChange={(e) => {
        const input = e.currentTarget;
        let raw = digits(input.value);
        let ordinal = digits(
          input.value.slice(0, input.selectionStart ?? input.value.length),
        ).length;
        const action = (e.nativeEvent as InputEvent).inputType;
        // Deleting a formatting character must still remove a digit, not restore it endlessly.
        if (raw === digits(previous.current) && action?.startsWith("delete")) {
          const index =
            action === "deleteContentBackward" ? ordinal - 1 : ordinal;
          if (index >= 0 && index < raw.length) {
            raw = raw.slice(0, index) + raw.slice(index + 1);
            if (action === "deleteContentBackward") ordinal--;
          }
        }
        const formatted = format(raw);
        input.value = formatted;
        previous.current = formatted;
        let position = 0,
          seen = 0;
        while (position < formatted.length && seen < ordinal) {
          if (/\d/.test(formatted[position])) seen++;
          position++;
        }
        input.setSelectionRange(position, position);
      }}
    />
  );
}
