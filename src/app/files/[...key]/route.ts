import { authorizeFileAccess } from "@/app/_lib/server-api";
import { getCurrentUser, toActor } from "@/server/auth/session";
import { log } from "@/server/log";
import { getFileStorage } from "@/server/storage";

/**
 * Private file route for licence and damage photos: /files/<storage key>.
 * Only the owner or an admin may read a file. Everything else — signed out,
 * someone else's file, unknown key — gets the same 404, so keys can't be probed.
 */
export async function GET(_request: Request, ctx: RouteContext<"/files/[...key]">) {
  const { key: parts } = await ctx.params;
  const key = parts.map((p) => decodeURIComponent(p)).join("/");
  const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

  const user = await getCurrentUser();
  if (!user) return notFound();

  let access: { contentType: string } | null;
  try {
    access = await authorizeFileAccess(toActor(user), key);
  } catch (error) {
    log.warn("app.files.authorize_failed", { error });
    return notFound();
  }
  if (!access) return notFound();

  const file = await getFileStorage().get(key);
  if (!file) return notFound();

  log.info("app.files.served", { userId: user.id, role: user.role, key });
  return new Response(new Uint8Array(file.body), {
    status: 200,
    headers: {
      "Content-Type": access.contentType,
      "Content-Length": String(file.body.byteLength),
      "Content-Disposition": "inline",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
