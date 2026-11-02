import { orchestrator } from "@/modules/orchestration/run-orchestrator";
import { errorResponse } from "@/modules/orchestration/http";

export async function POST(request: Request) {
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim();
  if (!idempotencyKey || idempotencyKey.length > 200) {
    return Response.json({ error: { code: "CONTRACT_VALIDATION_ERROR", message: "A valid Idempotency-Key header is required." } }, { status: 422 });
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return Response.json({ error: { code: "CONTRACT_VALIDATION_ERROR", message: "Content-Type must be application/json." } }, { status: 422 });
  }

  try {
    const body: unknown = await request.json();
    const result = await orchestrator.createRun(body, idempotencyKey);
    return Response.json(result.run, { status: result.created ? 201 : 200 });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return Response.json({ error: { code: "CONTRACT_VALIDATION_ERROR", message: "Malformed JSON body." } }, { status: 422 });
    }
    return errorResponse(error);
  }
}
