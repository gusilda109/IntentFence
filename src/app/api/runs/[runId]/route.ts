import { orchestrator, RunNotFoundError } from "@/modules/orchestration/run-orchestrator";
import { errorResponse } from "@/modules/orchestration/http";

export async function GET(
  _request: Request,
  context: { params: Promise<{ runId: string }> },
) {
  try {
    const { runId } = await context.params;
    const run = await orchestrator.getRun(runId);
    if (!run) throw new RunNotFoundError();
    return Response.json(run);
  } catch (error) {
    return errorResponse(error);
  }
}
