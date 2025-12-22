import React from "react";
import { supabase } from "../../lib/supabaseClient";

export default function TestDbPanel() {
  const [status, setStatus] = React.useState<string>("");

  const ensureWorkspace = async (): Promise<string | null> => {
    setStatus("Calling ensure_user_and_workspace...");
    const { data, error } = await supabase.rpc("ensure_user_and_workspace");
    console.log("[TestDbPanel] ensure_user_and_workspace:", { data, error });

    if (error) {
      setStatus(error.message);
      return null;
    }

    const workspaceId = (data?.[0]?.out_workspace_id as string | undefined) ?? null;
    if (!workspaceId) {
      setStatus("No out_workspace_id returned from RPC.");
      return null;
    }

    setStatus(`Workspace OK: ${workspaceId}`);
    return workspaceId;
  };

  const insertDraft = async () => {
    const workspaceId = await ensureWorkspace();
    if (!workspaceId) return;

    setStatus("Inserting test draft listing...");
    const { data, error } = await supabase
      .from("listings")
      .insert({
        workspace_id: workspaceId,
        status: "draft",
        marketplace: "ebay",
        title: "Test Draft Listing",
        description: "Test description",
        listing_json: {
          test: true,
          createdAt: new Date().toISOString(),
          itemSpecifics: [],
        },
      })
      .select("id, created_at")
      .single();

    console.log("[TestDbPanel] insert draft:", { data, error });

    if (error) {
      setStatus(error.message);
      return;
    }

    setStatus(`Inserted listing: ${data.id}`);
  };

  const fetchDrafts = async () => {
    const workspaceId = await ensureWorkspace();
    if (!workspaceId) return;

    setStatus("Fetching latest listings...");
    const { data, error } = await supabase
      .from("listings")
      .select("id, status, title, created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(10);

    console.log("[TestDbPanel] fetch listings:", { data, error });

    if (error) {
      setStatus(error.message);
      return;
    }

    setStatus(`Fetched ${data?.length ?? 0} listings (see console).`);
  };

  return (
    <div style={{ marginTop: 16, padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>DB Test Panel (temporary)</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" onClick={ensureWorkspace}>Ensure Workspace</button>
        <button type="button" onClick={insertDraft}>Insert Draft Listing</button>
        <button type="button" onClick={fetchDrafts}>Fetch Listings</button>
      </div>
      {status ? <div style={{ marginTop: 10 }}>{status}</div> : null}
    </div>
  );
}
