export async function withInvalidStructuredOutputRetry<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!(error instanceof Error) || error.name !== "ModelBehaviorError") throw error;
    return operation();
  }
}
