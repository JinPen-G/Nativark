/** 原路径保留公共名称，正文由 Rental 任务中心提供。 */
export * from "@rental-os/rental-core/admin/task-center/task-opening-proposal-session";
import { createTaskOpeningProposalSession as createSession } from "@rental-os/rental-core/admin/task-center/task-opening-proposal-session";
import { aiTaskOpeningProposalsApi } from "@/api/aiTaskOpeningProposals";
type SessionOptions = Parameters<typeof createSession>[0];
export function createTaskOpeningProposalSession(input: Omit<SessionOptions, "api"> & { api?: SessionOptions["api"] }) {
  return createSession({ ...input, api: input.api ?? aiTaskOpeningProposalsApi });
}
