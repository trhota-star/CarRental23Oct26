import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/server/auth";

// better-auth's HTTP endpoints (/api/auth/*). Built lazily so builds don't need the DB.
const handler = (request: Request) => getAuth().handler(request);

export const { GET, POST, PATCH, PUT, DELETE } = toNextJsHandler(handler);
