-- Evidence IDs are stable Replay fixture IDs and must be unique per Run, not globally.
DROP INDEX "EvidenceRecord_evidenceId_key";
CREATE UNIQUE INDEX "EvidenceRecord_runId_evidenceId_key" ON "EvidenceRecord"("runId", "evidenceId");
