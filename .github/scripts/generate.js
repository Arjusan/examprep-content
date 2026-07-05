// .github/scripts/generate.js
// Runs inside GitHub Actions — reads syllabus, calls Gemini, writes to /staging/

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import fetch from 'node-fetch';

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const TARGET_EXAM = process.env.TARGET_EXAM || 'all';
const TARGET_SUBJECT = process.env.TARGET_SUBJECT || '';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`;

const EXAMS = ['si', 'icds', 'panchayat', 'tet'];
const today = new Date().toISOString().split('T')[0];

// ─── HELPERS ───────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function loadJSON(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch(e) { return null; }
}

function writeJSON(path, data) {
  const dir = path.split('/').slice(0, -1).join('/');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2));
}

// ─── GEMINI CALL ────────────────────────────────────────────
async function callGemini(prompt, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(GEMINI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: 'You are an expert MCQ setter for West Bengal government exams. Return ONLY valid JSON array. No markdown, no preamble.' }]
          },
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.75, maxOutputTokens: 8192 }
        })
      });

      const data = await res.json();
      if (data.error) throw new Error(data.error.message);

      const raw = data.candidates[0].content.parts[0].text
        .trim()
        .replace(/```json|```/g, '')
        .trim();

      return JSON.parse(raw);
    } catch(e) {
      console.error(`Attempt ${attempt + 1} failed: ${e.message}`);
      if (attempt < retries - 1) await sleep(5000);
    }
  }
  return [];
}

// ─── BUILD PROMPT ───────────────────────────────────────────
function buildPrompt(examName, subjectName, topicName, topicId, pyqSample, difficulty = 'Mixed') {
  const sampleText = pyqSample?.length > 0
    ? `\nHere are real PYQ examples from this topic for style reference:\n${pyqSample.slice(0, 3).map(q => `- "${q.question}" (Answer: ${q.options[q.correctIndex]})`).join('\n')}`
    : '';

  return `Generate exactly 20 unique MCQ questions for the ${examName} government exam.
Subject: ${subjectName}
Topic: ${topicName}
Difficulty distribution: 6 Easy, 10 Medium, 4 Hard
Focus: West Bengal context where applicable, real exam style
${sampleText}

Rules:
- Questions must be exam-accurate, no trick questions
- Each question has exactly 4 options
- Correct answer must be definitively correct
- Explanation must be concise (1-2 sentences max)
- No duplicate questions

Return ONLY this JSON array:
[{
  "id": "ai_${topicId}_${today.replace(/-/g,'')}_001",
  "question": "...",
  "options": ["A", "B", "C", "D"],
  "correctIndex": 0,
  "explanation": "...",
  "difficulty": "Easy|Medium|Hard",
  "topicId": "${topicId}",
  "source": "ai_generated",
  "generatedDate": "${today}"
}]

Generate all 20 questions now. Number the id suffix sequentially 001 to 020.`;
}

// ─── MAIN ───────────────────────────────────────────────────
async function main() {
  const examsToProcess = TARGET_EXAM === 'all' ? EXAMS : [TARGET_EXAM];
  let totalGenerated = 0;
  let totalFailed = 0;

  for (const exam of examsToProcess) {
    console.log(`\n📚 Processing exam: ${exam.toUpperCase()}`);

    const syllabus = loadJSON(`syllabus/${exam}.json`);
    if (!syllabus) {
      console.warn(`  ⚠️ No syllabus found for ${exam}, skipping`);
      continue;
    }

    const pyqBank = loadJSON(`pyq/${exam}.json`);
    const allSubjects = syllabus.prelims?.subjects || [];

    const stagingBatch = {
      exam,
      generatedDate: today,
      generatedAt: new Date().toISOString(),
      source: 'ai_generated',
      reviewStatus: 'pending',
      totalQuestions: 0,
      subjects: {}
    };

    for (const subject of allSubjects) {
      // Filter by subject if specified
      if (TARGET_SUBJECT && subject.name !== TARGET_SUBJECT) continue;

      console.log(`  📖 Subject: ${subject.name}`);
      stagingBatch.subjects[subject.id] = {};

      // Only process HIGH and MEDIUM weight topics to stay within quota
      const priorityTopics = subject.topics.filter(t =>
        t.weight === 'high' || t.weight === 'medium'
      );

      for (const topic of priorityTopics) {
        console.log(`    🎯 Topic: ${topic.name} (weight: ${topic.weight})`);

        // Get PYQ samples for this topic for style reference
        const pyqSample = pyqBank?.questions?.filter(q =>
          q.topicId === topic.id
        ) || [];

        const prompt = buildPrompt(
          syllabus.examName,
          subject.name,
          topic.name,
          topic.id,
          pyqSample
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
          console.log(`    ✅ Generated ${questions.length} questions`);
        } else {
          totalFailed++;
          console.warn(`    ❌ Failed to generate for ${topic.name}`);
        }

        // Rate limiting — 15 req/min free tier = 4s between calls
        await sleep(4500);
      }
    }

    // Write to staging
    const stagingPath = `staging/${exam}/${today}.json`;
    writeJSON(stagingPath, stagingBatch);
    console.log(`\n  💾 Saved to ${stagingPath}`);
    console.log(`  📊 Total: ${stagingBatch.totalQuestions} questions for ${exam}`);
  }

  console.log(`\n🎉 Generation complete!`);
  console.log(`   Total generated: ${totalGenerated} questions`);
  console.log(`   Failed batches: ${totalFailed}`);

  if (totalFailed > 0) process.exit(1);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
