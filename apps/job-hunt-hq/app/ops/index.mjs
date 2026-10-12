import { getJobSearchContext } from "./context.mjs";
import { saveCandidateContext, saveResumeDraft, saveResumeQaAnswer } from "./resume.mjs";

export { getJobSearchContext, jobSearchContextQuery, JOB_PROVIDERS } from "./context.mjs";
export { saveCandidateContext, saveResumeDraft, saveResumeQaAnswer } from "./resume.mjs";

export const jobHuntOperations = Object.freeze({
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
