// .github/scripts/publish.js
// Copies admin-approved questions from /staging/ to /live/

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';

const TARGET_EXAM = process.env.TARGET_EXAM || 'si';
const TARGET_DATE = process.env.TARGET_DATE || new Date().toISOString().split('T')[0];

function loadJSON(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch(e) { return null; }
}

function writeJSON(path, data) {
  const dir = path.split('/').slice(0, -1).join('/');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2));
}

function main() {
  console.log(`📤 Publishing ${TARGET_EXAM} for ${TARGET_DATE}`);

  const stagingPath = `staging/${TARGET_EXAM}/${TARGET_DATE}.json`;
  const staging = loadJSON(stagingPath);

  if (!staging) {
    console.error(`❌ No staging file found at ${stagingPath}`);
    process.exit(1);
  }

  // Filter to only approved questions
  const publishBatch = {
    ...staging,
    reviewStatus: 'published',
    publishedAt: new Date().toISOString(),
    subjects: {}
  };

  let publishedCount = 0;
  let removedCount = 0;

  for (const [subjectId, topics] of Object.entries(staging.subjects)) {
    publishBatch.subjects[subjectId] = {};

    for (const [topicId, topicData] of Object.entries(topics)) {
      // Only include approved questions (not rejected ones)
      const approved = (topicData.questions || []).filter(q =>
        q.adminStatus !== 'rejected'
      );

      if (approved.length > 0) {
        publishBatch.subjects[subjectId][topicId] = {
          ...topicData,
          questions: approved,
          questionCount: approved.length
        };
        publishedCount += approved.length;
        removedCount += (topicData.questions.length - approved.length);
      }
    }
  }

  publishBatch.totalQuestions = publishedCount;

  // Write to live
  const livePath = `live/${TARGET_EXAM}/${TARGET_DATE}.json`;
  writeJSON(livePath, publishBatch);

  // Also write a "latest" pointer so student app always gets fresh questions
  const latestPointer = {
    latestDate: TARGET_DATE,
    latestFile: `live/${TARGET_EXAM}/${TARGET_DATE}.json`,
    updatedAt: new Date().toISOString()
  };
  writeJSON(`live/${TARGET_EXAM}/latest.json`, latestPointer);

  console.log(`✅ Published ${publishedCount} questions to ${livePath}`);
  console.log(`🗑️  Removed ${removedCount} rejected questions`);
  console.log(`📍 Updated latest pointer`);
}

main();
