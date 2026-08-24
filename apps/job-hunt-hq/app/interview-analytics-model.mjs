const DIMENSIONS = Object.freeze(["evidence", "structure", "depth", "relevance"]);

function text(value, maximum = 1200) {
  return String(value ?? "")
    .trim()
    .slice(0, maximum);
}

function score(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}

function timestamp(value) {
  const parsed = Date.parse(text(value, 80));
  return Number.isFinite(parsed) ? parsed : -1;
}

function average(values) {
  const numbers = values.filter((value) => Number.isFinite(value));
  return numbers.length
    ? Math.round(numbers.reduce((total, value) => total + value, 0) / numbers.length)
    : null;
}

function orderedReviews(question = {}) {
  return (Array.isArray(question.practiceReviews) ? question.practiceReviews : [])
    .map((review, index) => ({ review, index, at: timestamp(review?.createdAt) }))
    .sort((left, right) => right.at - left.at || left.index - right.index)
    .map(({ review }) => review);
}

function dimensionAverage(entries, key) {
  return average(entries.map((entry) => score(entry.review?.dimensions?.[key])));
}

function change(current, previous) {
  return Number.isFinite(current) && Number.isFinite(previous) ? current - previous : null;
}

function competencyStatus(value) {
  if (value >= 80) return "strong";
  if (value >= 70) return "developing";
  return "weak";
}

export function buildInterviewQuestionPracticeHistory(question = {}, options = {}) {
  const attempts = (Array.isArray(question.practiceAttempts) ? question.practiceAttempts : [])
    .map((attempt, index) => ({
      attempt,
      index,
      at: timestamp(attempt?.updatedAt || attempt?.createdAt),
    }))
    .sort((left, right) => left.at - right.at || right.index - left.index);
  const reviews = orderedReviews(question);
  const reviewByAttemptId = new Map();
  for (const review of reviews) {
    const attemptId = text(review?.practiceAttemptId, 100);
    if (attemptId && !reviewByAttemptId.has(attemptId)) reviewByAttemptId.set(attemptId, review);
  }
  if (attempts.length === 1 && !reviewByAttemptId.size && reviews.length) {
    reviewByAttemptId.set(text(attempts[0].attempt?.id, 100), reviews[0]);
  }
  let previousScore = null;
  const chronological = attempts.map(({ attempt }, index) => {
    const id = text(attempt?.id, 100);
    const review = reviewByAttemptId.get(id) || null;
    const currentScore = review ? score(review.overallScore) : null;
    const delta =
      currentScore !== null && previousScore !== null ? currentScore - previousScore : null;
    if (currentScore !== null) previousScore = currentScore;
    return {
      attemptId: id,
      sequence: index + 1,
      answer: text(attempt?.answer, 6000),
      inputMode: ["voice", "mixed"].includes(attempt?.inputMode) ? attempt.inputMode : "typed",
      createdAt: text(attempt?.updatedAt || attempt?.createdAt, 80),
      reviewId: text(review?.id, 100),
      score: currentScore,
      delta,
      reviewedAt: text(review?.createdAt, 80),
    };
  });
  const limit = Math.max(1, Math.min(12, Number(options.limit) || 6));
  return chronological.reverse().slice(0, limit);
}

export function buildInterviewTrainingInsights(questionBank = [], options = {}) {
  const questions = (Array.isArray(questionBank) ? questionBank : []).filter(
    (question) => question && question.status !== "archived",
  );
  const entries = questions
    .map((question) => {
      const reviews = orderedReviews(question);
      if (!reviews.length) return null;
      return {
        question,
        review: reviews[0],
        previousReview: reviews[1] || null,
        reviewCount: reviews.length,
      };
    })
    .filter(Boolean);
  const previousEntries = entries.filter((entry) => entry.previousReview);
  const averageScore = average(entries.map((entry) => score(entry.review.overallScore)));
  const previousAverageScore = average(
    previousEntries.map((entry) => score(entry.previousReview.overallScore)),
  );
  const dimensions = DIMENSIONS.map((key) => {
    const currentAverage = dimensionAverage(entries, key);
    const previousAverage = dimensionAverage(
      previousEntries.map((entry) => ({ review: entry.previousReview })),
      key,
    );
    return {
      key,
      average: currentAverage,
      previousAverage,
      delta: change(currentAverage, previousAverage),
    };
  });

  const competencyGroups = new Map();
  for (const entry of entries) {
    const name = text(entry.question.competency, 120) || text(entry.question.category, 80) || "待分类";
    const group = competencyGroups.get(name) || [];
    group.push(entry);
    competencyGroups.set(name, group);
  }
  const competencies = [...competencyGroups.entries()]
    .map(([name, group]) => {
      const groupPrevious = group.filter((entry) => entry.previousReview);
      const currentAverage = average(group.map((entry) => score(entry.review.overallScore)));
      const previousAverage = average(
        groupPrevious.map((entry) => score(entry.previousReview.overallScore)),
      );
      return {
        name,
        averageScore: currentAverage,
        previousAverageScore: previousAverage,
        delta: change(currentAverage, previousAverage),
        questionCount: group.length,
        reviewCount: group.reduce((total, entry) => total + entry.reviewCount, 0),
        status: competencyStatus(currentAverage ?? 0),
      };
    })
    .sort(
      (left, right) =>
        (left.averageScore ?? 101) - (right.averageScore ?? 101) ||
        right.questionCount - left.questionCount ||
        left.name.localeCompare(right.name),
    )
    .slice(0, Math.max(1, Math.min(12, Number(options.competencyLimit) || 6)));

  const latest = entries
    .map((entry) => ({ ...entry, at: timestamp(entry.review.createdAt) }))
    .sort((left, right) => right.at - left.at)[0];
  return {
    reviewedQuestionCount: entries.length,
    reviewCount: entries.reduce((total, entry) => total + entry.reviewCount, 0),
    attemptCount: questions.reduce(
      (total, question) => total + (Array.isArray(question.practiceAttempts) ? question.practiceAttempts.length : 0),
      0,
    ),
    averageScore,
    previousAverageScore,
    trendDelta: change(averageScore, previousAverageScore),
    dimensions,
    competencies,
    weakestDimension:
      dimensions
        .filter((item) => Number.isFinite(item.average))
        .sort((left, right) => left.average - right.average)[0] || null,
    latestFeedback: latest
      ? {
          bankQuestionId: latest.question.id,
          question: latest.question.question,
          competency: latest.question.competency || latest.question.category,
          overallScore: score(latest.review.overallScore),
          dimensions: { ...latest.review.dimensions },
          strengths: [...(latest.review.strengths || [])],
          improvements: [...(latest.review.improvements || [])],
          optimizedAnswer: text(latest.review.optimizedAnswer, 3000),
          followUp: text(latest.review.followUp, 600),
          practiceAttemptId: text(latest.review.practiceAttemptId, 100),
          createdAt: text(latest.review.createdAt, 80),
        }
      : null,
  };
}

export function buildInterviewFollowUpDraft(parentQuestion = {}, review = {}, options = {}) {
  const question = text(review.followUp, 1200);
  if (question.length < 8) return null;
  const now = text(options.now, 80) || new Date().toISOString();
  const status = options.status === "ready" ? "ready" : "inbox";
  const reviewId = text(review.id, 100);
  const parentId = text(parentQuestion.id, 100);
  return {
    question,
    category: text(parentQuestion.category, 80) || "动态追问",
    competency:
      text(parentQuestion.competency, 120) || text(parentQuestion.category, 80) || "追问应答",
    type: text(parentQuestion.type, 40) || "other",
    difficulty: parentQuestion.difficulty === "挑战" ? "挑战" : "进阶",
    priority: "high",
    status,
    origin: "manual",
    tags: [...new Set([...(parentQuestion.tags || []), "动态追问"])].slice(0, 16),
    sourceRefs: [
      ...(reviewId ? [`practice-review:${reviewId}`] : []),
      ...(parentId ? [`question:${parentId}`] : []),
      ...(parentQuestion.sourceRefs || []),
    ].filter((item, index, values) => values.indexOf(item) === index).slice(0, 16),
    answerPoints: [],
    recommendedAnswer: "",
    followUps: [],
    notes: parentQuestion.question ? `来自上一题的动态追问：${text(parentQuestion.question, 500)}` : "",
    jobIds: [...(parentQuestion.jobIds || [])],
    sourceSetIds: [...(parentQuestion.sourceSetIds || [])],
    practiceAttempts: [],
    practiceReviews: [],
    createdAt: now,
    updatedAt: now,
  };
}
