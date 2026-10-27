"use client";
import { useState } from "react";
import { Login } from "@/components/crm";
import { supabase } from "@/lib/supabase";
export default function LoginPage() {
  const [message, setMessage] = useState("");
  return supabase ? (
    <Login message={message} onMessage={setMessage} />
  ) : (
    <div className="loading">
      <p>Backend sin configurar.</p>
      <a href="/">Abrir demostración ficticia</a>
    </div>
  );
}
