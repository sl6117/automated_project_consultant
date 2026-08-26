import { getAppDb } from "@/server/db/app-db";
import { getArtifactVersion } from "@/server/ledger/artifact-versions";

export const dynamic = "force-dynamic";

// Downloads serve the persisted version row, never a fresh compile, so the
// saved file is byte-identical to the recorded snapshot.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string; versionId: string }> },
) {
  const { sessionId, versionId } = await params;

  let row;
  try {
    row = getArtifactVersion(getAppDb(), versionId);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  if (row.session_id !== sessionId) {
    return new Response("Not found", { status: 404 });
  }

  // filename comes from the schema-enforced artifact enum, never user input.
  return new Response(row.body, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${row.filename}"`,
    },
  });
}
