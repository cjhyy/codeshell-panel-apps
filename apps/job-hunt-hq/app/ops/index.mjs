import { saveJobOpportunities, saveJobResearch } from "./jobs.mjs";
import { buildJobResearchDigest } from "../job-research-digest.mjs";
import { getJobSearchContext } from "./context.mjs";
import { saveCandidateContext, saveResumeDraft, saveResumeQaAnswer } from "./resume.mjs";

export { getJobSearchContext, jobSearchContextQuery, JOB_PROVIDERS } from "./context.mjs";
export { saveCandidateContext, saveResumeDraft, saveResumeQaAnswer } from "./resume.mjs";

export const jobHuntOperations = Object.freeze({
  save_job_opportunities: Object.freeze({ mutates: true, run: saveJobOpportunities }),
  save_job_research: Object.freeze({ mutates: true, run: saveJobResearch }),
  get_job_research_digest: Object.freeze({ mutates: false, inputSchema: {"type": "object", "additionalProperties": false, "properties": {"since": {"type": "string", "maxLength": 80}, "now": {"type": "string", "maxLength": 80}, "limit": {"type": "integer", "minimum": 1, "maximum": 50}, "format": {"type": "string", "enum": ["json", "markdown"]}}}, run: (snapshot, args, ctx) => ({ snapshot, result: buildJobResearchDigest(snapshot, { now: ctx.now, ...args }) }) }),
  get_job_search_context: Object.freeze({ mutates: false, run: getJobSearchContext }),
  save_candidate_context: Object.freeze({ mutates: true, run: saveCandidateContext }),
  save_resume_draft: Object.freeze({ mutates: true, run: saveResumeDraft }),
  save_resume_qa_answer: Object.freeze({ mutates: true, run: saveResumeQaAnswer }),
});

export function runJobHuntOperation(name, snapshot, args = {}, ctx = {}) {
  const operation = jobHuntOperations[name];
  if (!Object.hasOwn(jobHuntOperations, name)) throw new Error(`不支持的求职操作：${name}`);
  return operation.run(snapshot, args, ctx);
}
