import { orchestrator } from "@/modules/orchestration/run-orchestrator";
import { errorResponse } from "@/modules/orchestration/http";

export async function POST(
  _request: Request,
  context: { params: Promise<{ runId: string }> },
) {
  try {
    const { runId } = await context.params;
    const result = await orchestrator.executeRun(runId);
    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
