export const API_ROOT =
  import.meta.env.VITE_API_ROOT ||
  (import.meta.env.DEV ? "http://localhost:3001" : "");
