// CivitAI model pages and their versions and files, read through CivitAI's public API
// (not the page markup, so site redesigns don't break it). Host-aware like Prompto:
// civitai.com, civitai.green and civitai.red pages ask their own host, with civitai.com
// as the fallback. No DOM and no chrome.* here.

const HOST = /(^|\.)civitai\.(com|green|red)$/;

// Model types Model Librarian downloads (others, like workflows or wildcards, aren't model files).
export const MODEL_TYPES = ["Checkpoint", "LORA", "LoCon", "DoRA", "TextualInversion", "VAE", "Controlnet", "Upscaler", "MotionModule", "Hypernetwork"];
const SKIP_FILES = ["Training Data", "Archive"];

export function parseModelPage(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (!HOST.test(u.hostname)) return null;
  const m = u.pathname.match(/^\/models\/(\d+)/);
  if (!m) return null;
  const v = u.searchParams.get("modelVersionId");
  return { host: u.hostname.replace(/^www\./, ""), modelId: Number(m[1]), versionId: v && /^\d+$/.test(v) ? Number(v) : null };
}

export async function fetchModel(host, modelId, fetchFn = fetch) {
  const get = async (h) => {
    const res = await fetchFn(`https://${h}/api/v1/models/${modelId}`, { credentials: "omit" });
    if (res.status === 404) throw Object.assign(new Error("CivitAI doesn't have this model (removed, or it needs a login)"), { status: 404 });
    if (!res.ok) throw new Error(`CivitAI answered ${res.status}`);
    return res.json();
  };
  try { return normalizeModel(await get(host)); } catch (e) {
    if (host === "civitai.com" || e.status === 404) throw e;
    return normalizeModel(await get("civitai.com")); // the API lives on civitai.com too
  }
}

export function normalizeModel(m) {
  return {
    id: m.id, name: m.name || `Model ${m.id}`, type: m.type || "", creator: m.creator?.username || "",
    downloadable: MODEL_TYPES.includes(m.type),
    versions: (m.modelVersions || []).map((v) => ({
      id: v.id, name: v.name || String(v.id), baseModel: v.baseModel || "",
      earlyAccess: !!(v.earlyAccessEndsAt && Date.parse(v.earlyAccessEndsAt) > Date.now()) || v.availability === "EarlyAccess",
      files: (v.files || []).filter((f) => !SKIP_FILES.includes(f.type)).map((f) => ({
        id: f.id, name: f.name || "", size: f.sizeKB ? Math.round(f.sizeKB * 1024) : null, primary: !!f.primary,
        type: f.type || "Model", label: fileLabel(f), metadata: { format: f.metadata?.format || null, fp: f.metadata?.fp || null },
      })).sort((a, b) => b.primary - a.primary),
    })),
  };
}

// "SafeTensor · fp16 · pruned", plus "VAE" for a version's bundled VAE file.
export function fileLabel(f) {
  const md = f.metadata || {};
  const bits = [md.format === "SafeTensor" ? "safetensors" : md.format, md.fp, md.size];
  if (f.type && !["Model", "Pruned Model"].includes(f.type)) bits.unshift(f.type);
  else if (f.type === "Pruned Model" && md.size !== "pruned") bits.push("pruned");
  return bits.filter(Boolean).map(String).join(" · ") || "file";
}

export function fmtSize(b) {
  if (!b && b !== 0) return "";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return `${b >= 100 || i === 0 ? Math.round(b) : b.toFixed(1)} ${u[i]}`;
}
