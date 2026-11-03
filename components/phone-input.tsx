"use client";
import { useState } from "react";
import { whatsappUrl } from "@/lib/phone";
function Icon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20.5 11.7a8.5 8.5 0 0 1-12.6 7.5L3 20.5l1.3-4.8a8.5 8.5 0 1 1 16.2-4Z" />
      <path d="m8.2 7.3 1.4-.3 1.1 2.5-1.1 1.2a8 8 0 0 0 3.7 3.4l1-1.2 2.5 1.1-.2 1.5c-.2 1-1.3 1.4-2.2 1.1-3.8-1.1-6.7-4-7.3-7-.2-1 .3-1.9 1.1-2.3Z" />
    </svg>
  );
}
export function WhatsAppLink({
  phone,
  showUnavailable = false,
}: {
  phone: string;
  showUnavailable?: boolean;
}) {
  const href = whatsappUrl(phone);
  return href ? (
    <a
      className="whatsapp-link"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Abrir chat de WhatsApp"
      title="Abrir chat de WhatsApp"
      onClick={(e) => e.stopPropagation()}
    >
      <Icon />
    </a>
  ) : showUnavailable ? (
    <span
      className="whatsapp-link unavailable"
      role="img"
      aria-label="WhatsApp no disponible: revisá el celular"
      title="Ingresá un celular completo; para otros países incluí + y el código de país."
    >
      <Icon />
    </span>
  ) : null;
}
export default function PhoneInput({ initial = "" }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <span className="phone-input">
      <input
        aria-label="Celular"
        name="phone"
        type="tel"
        autoComplete="tel"
        required
        value={value}
        onChange={(e) => setValue(e.target.value)}
        minLength={3}
        maxLength={40}
      />
      <WhatsAppLink phone={value} showUnavailable />
    </span>
  );
}
