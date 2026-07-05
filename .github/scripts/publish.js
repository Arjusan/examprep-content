// .github/scripts/publish.js
// Copies approved questions from /staging/ to /live/
// Node 24 built-in — no npm install needed

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';

const TARGET_EXAM = process.env.TARGET_EXAM || 'si';
const TARGET_DATE = process.env.TARGET_DATE || new Date().toISOString().split('T')[0];

function loadJSON(filePath) {
  try { return JSON.parse(readFileSync(filePath, 'utf8')); }
  catch(e) { return null; }
}

function writeJSON(filePath, data) {
  const dir = filePath.split('/').slice(0, -1).join('/');
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function main() {
  console.log(`📤 Publishing ${TARGET_EXAM} for ${TARGET_DATE}`);

  const stagingPath = `staging/${TARGET_EXAM}/${TARGET_DATE}.json`;
  const staging = loadJSON(stagingPath);

  if (!staging) {
    console.error(`❌ No staging file found at ${stagingPath}`);
    console.error(`   Run "Generate Daily Question Sets" workflow first`);
    process.exit(1);
  }

  console.log(`✅ Found staging file with ${staging.totalQuestions} questions`);

  const publishBatch = {
    ...staging,
    reviewStatus: 'published',
    publishedAt: new Date().toISOString(),
    subjects: {}
  };

  let publishedCount = 0;
  let rejectedCount = 0;

  for (const [subjectId, topics] of Object.entries(staging.subjects || {})) {
    publishBatch.subjects[subjectId] = {};

    for (const [topicId, topicData] of Object.entries(topics)) {
      const approved = (topicData.questions || []).filter(q =>
        q.adminStatus !== 'rejected'
      );
      const rejected = topicData.questions.length - approved.length;

      if (approved.length > 0) {
        publishBatch.subjects[subjectId][topicId] = {
          ...topicData,
          questions: approved,
          questionCount: approved.length
        };
        publishedCount += approved.length;
        rejectedCount += rejected;
      }
    }
  }

  publishBatch.totalQuestions = publishedCount;

  // Write to live
  const livePath = `live/${TARGET_EXAM}/${TARGET_DATE}.json`;
  writeJSON(livePath, publishBatch);

  // Update latest pointer — student app reads this first
  writeJSON(`live/${TARGET_EXAM}/latest.json`, {
    latestDate: TARGET_DATE,
    latestFile: livePath,
    totalQuestions: publishedCount,
    updatedAt: new Date().toISOString()
  });

  console.log(`✅ Published ${publishedCount} questions → ${livePath}`);
  if (rejectedCount > 0) console.log(`🗑️  Skipped ${rejectedCount} rejected questions`);
  console.log(`📍 Updated latest.json pointer`);
}

main();
