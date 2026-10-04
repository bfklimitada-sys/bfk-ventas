// Agrega la sesión de BFK (token de Supabase) a toda llamada a /api/oc.
// El servidor la valida; sin sesión válida responde 401.
const SESSION_KEY = "bfk_supabase_session_v2";
const original = window.fetch.bind(window);

window.fetch = (input, init) => {
  try {
    const url = typeof input === "string" ? input : input?.url || "";
    if (url.startsWith("/api/oc")) {
      const raw = localStorage.getItem(SESSION_KEY);
      const token = raw ? JSON.parse(raw)?.access_token : null;
      if (token) {
        const headers = new Headers(init?.headers || (typeof input !== "string" ? input.headers : undefined));
        headers.set("Authorization", `Bearer ${token}`);
        return original(input, { ...init, headers });
      }
    }
  } catch {}
  return original(input, init);
};
