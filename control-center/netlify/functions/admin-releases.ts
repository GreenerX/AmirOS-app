import type { Config, Context } from "@netlify/functions";
import { requireAdmin } from "./_shared/auth";
import { databaseUnavailable, ensureControlAccount, getSupabaseAdmin } from "./_shared/supabase";
import { json, methodNotAllowed } from "./_shared/http";

const releaseChannels = new Set(["internal", "beta", "stable"]);

type CreateReleaseInput = {
  action?: unknown;
  channel?: unknown;
  version?: unknown;
  downloadUrl?: unknown;
  sha256?: unknown;
  releaseNotesUrl?: unknown;
  mode?: unknown;
  releaseId?: unknown;
};

function validHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

async function adminContext() {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const client = getSupabaseAdmin();
  if (client instanceof Response) return client;
  const operator = await ensureControlAccount(client, admin);
  if (operator instanceof Response) return operator;
  return { client, operator };
}

export default async (request: Request, _context: Context): Promise<Response> => {
  const context = await adminContext();
  if (context instanceof Response) return context;
  const { client, operator } = context;

  if (request.method === "GET") {
    const [channelsResult, releasesResult] = await Promise.all([
      client.from("control_release_channels").select("channel,mode,approved_release_id,updated_at").order("channel"),
      client.from("control_releases").select("id,channel,version,download_url,sha256,release_notes_url,published_at,is_active,created_at").order("created_at", { ascending: false }).limit(100),
    ]);
    if (channelsResult.error || releasesResult.error) return databaseUnavailable();
    return json({
      channels: (channelsResult.data || []).map((channel) => ({ channel: channel.channel, mode: channel.mode, approvedReleaseId: channel.approved_release_id, updatedAt: channel.updated_at })),
      releases: (releasesResult.data || []).map((release) => ({ id: release.id, channel: release.channel, version: release.version, downloadUrl: release.download_url, sha256: release.sha256, releaseNotesUrl: release.release_notes_url || undefined, publishedAt: release.published_at || undefined, isActive: release.is_active, createdAt: release.created_at })),
    });
  }

  const input = await request.json().catch(() => undefined) as CreateReleaseInput | undefined;
  if (!input || typeof input.channel !== "string" || !releaseChannels.has(input.channel)) return json({ message: "Choose a valid release channel." }, 400);

  if (request.method === "POST") {
    if (input.action !== "create" || typeof input.version !== "string" || !validHttpsUrl(input.downloadUrl) || typeof input.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(input.sha256) || (input.releaseNotesUrl !== undefined && input.releaseNotesUrl !== "" && !validHttpsUrl(input.releaseNotesUrl))) {
      return json({ message: "Enter a version, HTTPS download URL, SHA-256 hash, and optional HTTPS release-notes URL." }, 400);
    }
    const { data, error } = await client.rpc("control_create_release", {
      p_actor_user_id: operator.netlify_user_id,
      p_channel: input.channel,
      p_version: input.version,
      p_download_url: input.downloadUrl,
      p_sha256: input.sha256,
      p_release_notes_url: input.releaseNotesUrl || null,
    });
    if (error || !data) return json({ message: "The release could not be saved." }, 409);
    return json({ release: data }, 201);
  }

  if (request.method === "PATCH") {
    if ((input.mode !== "hold" && input.mode !== "available") || (input.mode === "available" && (!Number.isInteger(input.releaseId) || (input.releaseId as number) < 1))) {
      return json({ message: "Choose Hold, or select a release to make available." }, 400);
    }
    const { data, error } = await client.rpc("control_set_release_channel", {
      p_actor_user_id: operator.netlify_user_id,
      p_channel: input.channel,
      p_mode: input.mode,
      p_release_id: input.mode === "available" ? input.releaseId : null,
    });
    if (error || !data) return json({ message: "The release channel could not be updated." }, 409);
    return json({ channel: data });
  }
  return methodNotAllowed();
};

export const config: Config = { path: "/api/admin/releases", method: ["GET", "POST", "PATCH"] };
