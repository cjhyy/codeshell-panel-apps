# Job Hunt HQ data contract

Use project snapshot schema version 2. Treat IDs as opaque strings.

## Root snapshot

```json
{
  "schemaVersion": 2,
  "updatedAt": "ISO-8601",
  "selectedJobId": "job-id",
  "selectedInterviewSetId": "set-id",
  "profile": {},
  "jobs": [],
  "repos": [],
  "experiences": [],
  "jobResearch": [],
  "resume": {},
  "versions": [],
  "interviewSets": [],
  "workflowRuns": []
}
```

## Job

Store one normalized record for every role:

```json
{
  "id": "job-id",
  "company": "Company name",
  "title": "Role title",
  "location": "Location",
  "salary": "Source text",
  "source": "BOSS 直聘",
  "sourceId": "boss",
  "url": "https://canonical-job-url",
  "publishedAt": "Source date or empty",
  "employmentType": "Full-time or source text",
  "description": "Available JD text or listing excerpt",
  "jdCompleteness": "full | partial | listing_only",
  "verificationNotes": "Missing fields or access limitation",
  "fetchedAt": "ISO-8601",
  "match": 82,
  "status": "saved",
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601"
}
```

Deduplicate by canonical URL first, then
`sourceId + company + title + location`. Save partial records early and update
the same record as stronger evidence becomes available. Never call a listing
excerpt a full JD.

## Job research

Store one current report per `jobId`:

```json
{
  "id": "research-id",
  "jobId": "job-id",
  "updatedAt": "ISO-8601",
  "company": {
    "officialName": "Company name",
    "website": "https://company.example",
    "careersUrl": "https://company.example/careers",
    "summary": "Sourced company summary",
    "industry": "Industry or empty",
    "stage": "Funding/listing stage or empty",
    "size": "Sourced range or empty",
    "locations": ["Shanghai"],
    "products": ["Product A"],
    "techSignals": ["React"],
    "hiringSignals": ["Growing AI product team"]
  },
  "reviews": [
    {
      "source": "Review publisher",
      "title": "Short label",
      "url": "https://public-source",
      "publishedAt": "Source date or empty",
      "sentiment": "positive | mixed | negative | unknown",
      "summary": "Paraphrased subjective account",
      "pros": ["Recurring positive theme"],
      "cons": ["Recurring concern"],
      "confidence": "high | medium | low"
    }
  ],
  "interviewIntel": {
    "summary": "Sourced process summary",
    "process": ["Recruiter screen", "Technical interview"],
    "themes": ["React performance", "Project depth"],
    "questions": [
      {
        "question": "Paraphrased reported or predicted question",
        "category": "Frontend",
        "origin": "reported | predicted",
        "sourceUrl": "https://public-source-or-empty"
      }
    ]
  },
  "risks": ["Fact or concern that needs verification"],
  "sources": [
    {
      "kind": "official | job | review | interview | news | other",
      "title": "Source title",
      "publisher": "Publisher",
      "url": "https://source",
      "publishedAt": "Source date or empty",
      "accessedAt": "ISO-8601",
      "notes": "Scope or limitation"
    }
  ]
}
```

Do not merge multiple anonymous reviews into a claimed company fact. Keep
conflicting themes and low-confidence evidence visible.

## Workflow run

Use one run to expose progress in the panel:

```json
{
  "id": "workflow-id",
  "status": "running | completed | partial | failed",
  "currentStep": "discover | verify-jd | company | reviews | interviews | artifacts",
  "message": "Current progress or limitation",
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601",
  "steps": [
    {
      "id": "discover",
      "status": "pending | running | completed | skipped | failed",
      "message": "Optional detail"
    }
  ]
}
```

Reuse the returned `workflowId` for later progress updates.
