import { createRequire } from "node:module";
import type serverApp from "../sign-language-server/src/app";

type AppRequest = Parameters<typeof serverApp>[0];
type AppResponse = Parameters<typeof serverApp>[1];
const require = createRequire(import.meta.url);
const app = (
  require("../sign-language-server/dist/app.js") as {
    default: typeof serverApp;
  }
).default;

export default function handler(req: AppRequest, res: AppResponse) {
  const url = new URL(req.url || "/", "http://vercel.local");
  const route = url.searchParams.get("__route");
  if (route !== null) {
    url.searchParams.delete("__route");
    req.url = `/api/${route}${url.search}`;
  }
  return app(req, res);
}
