// .github/scripts/generate.js
// Node 24 built-in fetch — no npm install needed

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const TARGET_EXAM = process.env.TARGET_EXAM || 'si';
const TARGET_SUBJECT = process.env.TARGET_SUBJECT || '';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`;

const EXAMS = ['si', 'icds', 'panchayat', 'tet'];
const today = new Date().toISOString().split('T')[0];

// ─── HELPERS ────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function loadJSON(filePath) {
  try { return JSON.parse(readFileSync(filePath, 'utf8')); }
  catch(e) { return null; }
}

function writeJSON(filePath, data) {
  const dir = filePath.split('/').slice(0, -1).join('/');
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// ─── GEMINI CALL ────────────────────────────────────────────
async function callGemini(prompt, retries = 3) {
  if (!GEMINI_KEY) {
    console.error('❌ GEMINI_API_KEY secret is not set in this repo!');
    console.error('   Go to: Settings → Secrets → Actions → New secret');
    console.error('   Name: GEMINI_API_KEY, Value: your Gemini API key');
    process.exit(1);
  }

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(GEMINI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: 'Expert MCQ setter for West Bengal government exams. Return ONLY a valid JSON array. No markdown fences, no explanation text, no preamble — just the raw JSON array starting with [ and ending with ].' }]
          },
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 8192,
            responseMimeType: 'application/json'
          }
        })
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errText}`);
      }

      const data = await res.json();

      if (data.error) {
        throw new Error(`Gemini API error: ${data.error.message}`);
      }

      if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
        throw new Error('Empty response from Gemini');
      }

      const raw = data.candidates[0].content.parts[0].text
        .trim()
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error('Response is not a JSON array');
      return parsed;

    } catch(e) {
      console.error(`  Attempt ${attempt + 1}/${retries} failed: ${e.message}`);
      if (attempt < retries - 1) {
        console.log(`  Waiting 6s before retry...`);
        await sleep(6000);
      }
    }
  }
  return [];
}

// ─── BUILD PROMPT ───────────────────────────────────────────
function buildPrompt(examName, subjectName, topicName, topicId) {
  return `Generate exactly 10 unique MCQ questions for the ${examName} government exam in West Bengal.

Subject: ${subjectName}
Topic: ${topicName}
Difficulty: Mix of Easy (3), Medium (5), Hard (2)
Language: English
Style: Match real WB government exam question style — direct, factual, no ambiguity.

Requirements:
- Each question must have exactly 4 options (A, B, C, D format as array)
- correctIndex must be 0, 1, 2, or 3 (integer, not a letter)
- Explanation must be 1 sentence max
- Questions must be unique and exam-relevant
- West Bengal specific content where applicable

Return ONLY a JSON array (no other text):
[
  {
    "question": "Question text here?",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "correctIndex": 0,
    "explanation": "Brief explanation here.",
    "difficulty": "Easy",
    "topicId": "${topicId}",
    "source": "ai_generated",
    "generatedDate": "${today}"
  }
]`;
}

// ─── MAIN ───────────────────────────────────────────────────
async function main() {
  console.log(`\n🚀 ExamPrep Question Generator`);
  console.log(`📅 Date: ${today}`);
  console.log(`🎯 Target exam: ${TARGET_EXAM}`);
  console.log(`📖 Target subject: ${TARGET_SUBJECT || 'all'}`);
  console.log('');

  // Validate API key exists
  if (!GEMINI_KEY || GEMINI_KEY.trim() === '') {
    console.error('❌ GEMINI_API_KEY is not set!');
    console.error('   Add it: Settings → Secrets and variables → Actions → New repository secret');
    process.exit(1);
  }
  console.log('✅ API key found');

  const examsToProcess = TARGET_EXAM === 'all' ? EXAMS : [TARGET_EXAM];
  let totalGenerated = 0;
  let totalTopics = 0;
  let failedTopics = [];

  for (const exam of examsToProcess) {
    console.log(`\n📚 Processing: ${exam.toUpperCase()}`);

    const syllabus = loadJSON(`syllabus/${exam}.json`);
    if (!syllabus || !syllabus.prelims?.subjects?.length) {
      console.warn(`  ⚠️  Syllabus empty or missing for ${exam} — skipping`);
      continue;
    }

    const stagingBatch = {
      exam,
      generatedDate: today,
      generatedAt: new Date().toISOString(),
      source: 'ai_generated',
      reviewStatus: 'pending',
      totalQuestions: 0,
      subjects: {}
    };

    const allSubjects = syllabus.prelims.subjects;

    for (const subject of allSubjects) {
      if (TARGET_SUBJECT && subject.name !== TARGET_SUBJECT) continue;
      if (!subject.topics?.length) continue;

      console.log(`\n  📖 ${subject.name}`);
      stagingBatch.subjects[subject.id] = {};

      // Only HIGH weight topics to keep within free API quota
      const highTopics = subject.topics.filter(t => t.weight === 'high');

      for (const topic of highTopics) {
        totalTopics++;
        console.log(`    🎯 ${topic.name}...`);

        const prompt = buildPrompt(
          syllabus.examName || exam,
          subject.name,
          topic.name,
          topic.id
        );

        const questions = await callGemini(prompt);

        if (questions.length > 0) {
          stagingBatch.subjects[subject.id][topic.id] = {
            topicName: topic.name,
            subjectName: subject.name,
            questions,
            questionCount: questions.length
          };
          stagingBatch.totalQuestions += questions.length;
          totalGenerated += questions.length;
          console.log(`    ✅ ${questions.length} questions generated`);
        } else {
          failedTopics.push(`${exam}/${topic.name}`);
          console.warn(`    ⚠️  No questions generated for ${topic.name} — skipping`);
        }

        // Rate limit: free tier = 15 requests/minute
        // 5 second gap = max 12/min, safely under limit
        await sleep(5000);
      }
    }

    // Write staging file even if some topics failed
    const stagingPath = `staging/${exam}/${today}.json`;
    writeJSON(stagingPath, stagingBatch);
    console.log(`\n  💾 Saved → ${stagingPath}`);
    console.log(`  📊 ${stagingBatch.totalQuestions} questions for ${exam}`);
  }

  // Summary
  console.log('\n' + '═'.repeat(50));
  console.log(`🎉 Generation complete!`);
  console.log(`   Topics processed : ${totalTopics}`);
  console.log(`   Questions created: ${totalGenerated}`);
  if (failedTopics.length > 0) {
    console.log(`   Failed topics    : ${failedTopics.length}`);
    failedTopics.forEach(t => console.log(`     - ${t}`));
    console.log('   (These will be retried in the next run)');
  }
  console.log('═'.repeat(50));

  // Only fail if ZERO questions were generated
  if (totalGenerated === 0) {
    console.error('\n❌ No questions generated at all — check API key and syllabus files');
    process.exit(1);
  }

  console.log('\n✅ Success — staging files ready for admin review');
}

main().catch(e => {
  console.error('\n❌ Fatal error:', e.message);
  console.error(e.stack);
  process.exit(1);
});
