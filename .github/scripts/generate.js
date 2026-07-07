// ExamPrep Question Generator
// Uses Groq API (free tier — 14,400 req/day)
// Node 24 built-in fetch, zero dependencies

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';

// ── CONFIG ────────────────────────────────────────────────────
const API_KEY   = process.env.GEMINI_API_KEY; // same secret, now holds Groq key
const EXAM      = process.env.TARGET_EXAM || 'si';
const today     = new Date().toISOString().split('T')[0];

// Groq endpoint
const GROQ_URL  = 'https://api.groq.com/openai/v1/chat/completions';

// Models to try in order (all free on Groq)
const MODELS = [
  'llama-3.1-8b-instant',    // 14,400 req/day — primary
  'llama3-8b-8192',           // backup 1
  'gemma2-9b-it',             // backup 2
];

// ── HELPERS ───────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

function loadJSON(p) {
  try { return JSON.parse(readFileSync(p, 'utf8')); }
  catch(e) { return null; }
}

function writeJSON(p, d) {
  const dir = p.split('/').slice(0, -1).join('/');
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(p, JSON.stringify(d, null, 2));
}

// ── TEST WHICH MODEL WORKS ────────────────────────────────────
async function findWorkingModel() {
  for (const model of MODELS) {
    console.log(`  Testing ${model}...`);
    try {
      const res = await fetch(GROQ_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${API_KEY}`
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'Reply with the single word: OK' }],
          max_tokens: 10,
          temperature: 0
        })
      });
      const data = await res.json();
      if (data.error) {
        console.log(`  → ${data.error.message?.slice(0, 80)}`);
        continue;
      }
      if (data.choices?.[0]?.message?.content) {
        console.log(`  ✅ ${model} working!`);
        return model;
      }
    } catch(e) {
      console.log(`  → ${e.message.slice(0, 60)}`);
    }
    await sleep(1000);
  }
  return null;
}

// ── CALL GROQ API ─────────────────────────────────────────────
async function callGroq(model, prompt) {
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: 'You are an expert MCQ question setter for West Bengal government exams. You always return ONLY a valid JSON array. No markdown, no explanation, no preamble — just the raw JSON array.'
        },
        { role: 'user', content: prompt }
      ],
      max_tokens: 3000,
      temperature: 0.7
    })
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`HTTP ${res.status}: ${txt.slice(0, 100)}`);
  }

  const data = await res.json();
  if (data.error) throw new Error(data.error.message);

  const text = data.choices[0].message.content.trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error('Not a JSON array');
  return parsed;
}

// ── BUILD PROMPT ──────────────────────────────────────────────
function buildPrompt(examName, subjectName, topicName, topicId) {
  return `Generate exactly 5 unique MCQ questions for the ${examName} government exam in West Bengal, India.

Subject: ${subjectName}
Topic: ${topicName}
Date: ${today}

Rules:
- Questions must match real WB government exam style
- Each question has exactly 4 options
- West Bengal specific content where applicable
- correctIndex is 0, 1, 2, or 3 (integer)
- Explanation is 1 short sentence

Return ONLY this JSON array (no other text whatsoever):
[
  {
    "question": "Question text here?",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "correctIndex": 0,
    "explanation": "Brief explanation.",
    "difficulty": "Medium",
    "topicId": "${topicId}",
    "source": "ai_generated",
    "generatedDate": "${today}"
  }
]`;
}

// ── MAIN ──────────────────────────────────────────────────────
async function main() {
  console.log('╔══════════════════════════════════════╗');
  console.log('║   ExamPrep Question Generator        ║');
  console.log('║   Powered by Groq (Free Tier)        ║');
  console.log('╚══════════════════════════════════════╝');
  console.log(`Date : ${today}`);
  console.log(`Exam : ${EXAM}`);
  console.log('');

  // Check API key
  if (!API_KEY?.trim()) {
    console.log('ERROR: GEMINI_API_KEY secret is empty!');
    console.log('Add your Groq key: repo Settings → Secrets → Actions → GEMINI_API_KEY');
    console.log('Get free Groq key at: https://console.groq.com');
    process.exit(1);
  }

  // Detect if it's a Groq key or Gemini key
  if (!API_KEY.startsWith('gsk_')) {
    console.log('WARNING: Key does not look like a Groq key (should start with gsk_)');
    console.log('Get free Groq key at: https://console.groq.com → API Keys → Create API key');
    console.log('Then update the GEMINI_API_KEY secret with this Groq key');
    console.log('Continuing anyway...');
  }

  console.log(`Key  : ${API_KEY.slice(0, 10)}...`);
  console.log('');

  // Find working model
  console.log('Finding working model...');
  const model = await findWorkingModel();
  if (!model) {
    console.log('');
    console.log('ERROR: No Groq model responded successfully.');
    console.log('Check your Groq key at: https://console.groq.com');
    process.exit(1);
  }
  console.log('');

  // Load syllabus
  const syllabus = loadJSON(`syllabus/${EXAM}.json`);
  if (!syllabus?.prelims?.subjects?.length) {
    console.log(`ERROR: Syllabus missing for ${EXAM}`);
    console.log(`Check file: syllabus/${EXAM}.json`);
    process.exit(1);
  }
  console.log(`Syllabus : ${syllabus.examName}`);
  console.log(`Subjects : ${syllabus.prelims.subjects.length}`);
  console.log('');

  // Setup staging batch
  const batch = {
    exam: EXAM,
    generatedDate: today,
    generatedAt: new Date().toISOString(),
    model,
    provider: 'groq',
    source: 'ai_generated',
    reviewStatus: 'pending',
    totalQuestions: 0,
    subjects: {}
  };

  let total = 0;
  const failed = [];

  // Process HIGH weight topics only (conserves API quota)
  for (const subject of syllabus.prelims.subjects) {
    const topics = (subject.topics || []).filter(t => t.weight === 'high');
    if (!topics.length) continue;

    console.log(`📖 ${subject.name} (${topics.length} topics)`);
    batch.subjects[subject.id] = {};

    for (const topic of topics) {
      process.stdout.write(`   ${topic.name}... `);

      let questions = [];
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          questions = await callGroq(model, buildPrompt(
            syllabus.examName, subject.name, topic.name, topic.id
          ));
          break;
        } catch(e) {
          if (attempt === 3) {
            failed.push(topic.name);
          } else {
            await sleep(4000);
          }
        }
      }

      if (questions.length > 0) {
        batch.subjects[subject.id][topic.id] = {
          topicName: topic.name,
          subjectName: subject.name,
          questions,
          questionCount: questions.length
        };
        batch.totalQuestions += questions.length;
        total += questions.length;
        console.log(`✅ ${questions.length}Q`);
      } else {
        console.log('❌ failed');
      }

      // 2 second gap — Groq free tier is generous but let's be safe
      await sleep(2000);
    }
  }

  // Save to staging
  const stagingPath = `staging/${EXAM}/${today}.json`;
  writeJSON(stagingPath, batch);

  // Print summary
  console.log('');
  console.log('══════════════════════════════════════');
  console.log(`✅ Generated : ${total} questions`);
  console.log(`💾 Saved to  : ${stagingPath}`);
  if (failed.length) {
    console.log(`⚠️  Failed   : ${failed.join(', ')}`);
  }
  console.log('══════════════════════════════════════');

  if (total === 0) {
    console.log('ERROR: Zero questions generated.');
    process.exit(1);
  }
}

main().catch(e => {
  console.log(`Fatal: ${e.message}`);
  process.exit(1);
});
