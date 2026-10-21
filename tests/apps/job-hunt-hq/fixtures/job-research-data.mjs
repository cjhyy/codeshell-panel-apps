export const description = "岗位职责：\n负责 TypeScript 应用和数据产品的设计、实现、测试与可靠交付。\n" + "参与业务需求分析、代码审查、自动化测试、服务监控和文档维护，清晰记录个人负责的范围与设计取舍。".repeat(4) + "\n任职要求：\n熟悉 TypeScript 和 JavaScript，能够解释工程实践、分析问题并与团队合作。";
export const now = "2026-10-21T04:00:00Z";
export const ctx = { now, uid: prefix => `${prefix}-fixture` };
export const jobInput = { id: "job-fixture", company: "Fixture <script>|`", title: "TypeScript Engineer", source: "公司官网", source_id: "official", url: "https://example.invalid/jobs/1?utm_source=test", description, jd_completeness: "full", fetched_at: now };
export const researchInput = { job_id: jobInput.id, company: { official_name: "Fixture", summary: "公开夹具公司简介" }, reviews: [], risks: ["资料不足"], interview_intel: { summary: "未知", questions: [] }, sources: [{ kind: "official", title: "Fixture careers", url: jobInput.url, accessed_at: now }] };
