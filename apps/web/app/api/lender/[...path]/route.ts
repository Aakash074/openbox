// Server-side proxy for the demo lender desk: the lender key never reaches the browser.
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const KEY = process.env.LENDER_API_KEY ?? "lk_demo_openbox";

async function forward(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const url = `${API}/v1/lender/${path.join("/")}${new URL(req.url).search}`;
  const init: RequestInit = { method: req.method, headers: { authorization: `Bearer ${KEY}` } };
  if (req.method !== "GET") {
    init.body = await req.text();
    (init.headers as Record<string, string>)["content-type"] = "application/json";
  }
  try {
    const r = await fetch(url, init);
    return new Response(r.body, { status: r.status, headers: { "content-type": r.headers.get("content-type") ?? "application/json" } });
  } catch {
    return Response.json({ error: "unreachable", message: "The OpenBox API isn't reachable." }, { status: 502 });
  }
}
export const GET = forward;
export const POST = forward;
