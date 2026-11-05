// Server-side proxy: the merchant secret key never reaches the browser.
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const SK = process.env.MERCHANT_SECRET_KEY ?? "sk_demo_openbox";

async function forward(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const url = `${API}/v1/merchant/${path.join("/")}${new URL(req.url).search}`;
  const init: RequestInit = { method: req.method, headers: { authorization: `Bearer ${SK}` } };
  if (req.method !== "GET") {
    init.body = await req.text();
    (init.headers as Record<string, string>)["content-type"] = "application/json";
  }
  const r = await fetch(url, init);
  return new Response(r.body, { status: r.status, headers: { "content-type": r.headers.get("content-type") ?? "application/json", ...(r.headers.get("content-disposition") ? { "content-disposition": r.headers.get("content-disposition")! } : {}) } });
}
export const GET = forward;
export const POST = forward;
export const PUT = forward;
