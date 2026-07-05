// .github/scripts/generate-current-affairs.js
// Generates weekly current affairs per topic, with AI Summary label

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import fetch from 'node-fetch';

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const TARGET_EXAM = process.env.TARGET_EXAM || 'si';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`;
const today = new Date().toISOString().split('T')[0];

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

async function generateCurrentAffairs(examName, topicName, topicId) {
  const prompt = `You are helping students prepare for the ${examName} exam in West Bengal, India.

Generate 5 recent current affairs items (last 6 months) relevant to the topic: "${topicName}"

Each item should be exam-relevant — something that could be asked as an MCQ.

Return ONLY this JSON array:
[{
  "id": "ca_${topicId}_${today.replace(/-/g,'')}_001",
  "headline": "Short headline (max 10 words)",
  "detail": "2-3 sentences explaining what happened and why it matters for the exam",
  "examAngle": "What MCQ question could be asked from this? (1 sentence)",
  "keyFact": "The single most important fact to remember",
  "date": "approximate month and year (e.g. June 2025)",
  "topicId": "${topicId}",
  "isAIGenerated": true,
  "disclaimer": "AI Summary — verify with official sources before exam"
}]

Generate all 5 items numbered 001 to 005.`;

  try {
    const res = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: 'You are a current affairs expert for Indian government exams. Return ONLY valid JSON array.' }] },
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.6, maxOutputTokens: 4096 }
      })
    });

    const data = await res.json();
    if (data.error) throw new Error(data.error.message);

    const raw = data.candidates[0].content.parts[0].text
      .trim().replace(/```json|```/g, '').trim();
    return JSON.parse(raw);
  } catch(e) {
    console.error(`  Failed for ${topicName}: ${e.message}`);
    return [];
  }
}

async function main() {
  console.log(`📰 Generating current affairs for ${TARGET_EXAM}`);

  const syllabus = loadJSON(`syllabus/${TARGET_EXAM}.json`);
  if (!syllabus) { console.error('No syllabus found'); process.exit(1); }

  // Only generate current affairs for HIGH weight topics
  const highTopics = syllabus.prelims.subjects
    .flatMap(s => s.topics.filter(t => t.weight === 'high')
    .map(t => ({ ...t, subjectName: s.name })));

  console.log(`Found ${highTopics.length} high-priority topics`);

  for (const topic of highTopics) {
    console.log(`  📰 ${topic.name}`);

    const items = await generateCurrentAffairs(
      syllabus.examName, topic.name, topic.id
    );

    if (items.length > 0) {
      const output = {
        topicId: topic.id,
        topicName: topic.name,
        examId: TARGET_EXAM,
        generatedDate: today,
        weekOf: getWeekStart(),
        isAIGenerated: true,
        disclaimer: "⚠️ AI Summary — These are AI-generated summaries of recent events. Always verify with official sources (PIB, The Hindu, DD News) before your exam.",
        items
      };

      writeJSON(`current-affairs/${TARGET_EXAM}/${topic.id}.json`, output);
      console.log(`  ✅ Saved ${items.length} items`);
    }

    await sleep(4500);
  }

  console.log('\n✅ Current affairs generation complete');
}

function getWeekStart() {
  const d = new Date();
  d.setDate(d.getDate() - d.getDay());
  return d.toISOString().split('T')[0];
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
