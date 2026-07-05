// .github/scripts/generate-current-affairs.js
// Node 24 built-in fetch — no npm install needed

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const TARGET_EXAM = process.env.TARGET_EXAM || 'si';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`;
const today = new Date().toISOString().split('T')[0];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function loadJSON(p) { try { return JSON.parse(readFileSync(p,'utf8')); } catch(e) { return null; } }
function writeJSON(p, d) { const dir=p.split('/').slice(0,-1).join('/'); if(dir&&!existsSync(dir))mkdirSync(dir,{recursive:true}); writeFileSync(p,JSON.stringify(d,null,2)); }

async function generateCA(examName, topicName, topicId) {
  const prompt = `Generate 5 current affairs items (from the last 6 months, 2025) relevant to "${topicName}" for the ${examName} exam in West Bengal.

Each item should be something that could appear as an MCQ question.

Return ONLY a JSON array:
[{
  "headline": "Short headline (max 8 words)",
  "detail": "2 sentences: what happened and why it matters for exam.",
  "examAngle": "Potential MCQ question from this item.",
  "keyFact": "Single most important fact to remember.",
  "date": "Month Year (e.g. June 2025)",
  "topicId": "${topicId}",
  "isAIGenerated": true
}]`;

  try {
    const res = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: 'Current affairs expert for Indian government exams. Return ONLY valid JSON array.' }] },
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.6, maxOutputTokens: 4096, responseMimeType: 'application/json' }
      })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    const raw = data.candidates[0].content.parts[0].text.trim().replace(/```json|```/g,'').trim();
    return JSON.parse(raw);
  } catch(e) {
    console.error(`  Failed: ${e.message}`);
    return [];
  }
}

async function main() {
  console.log(`📰 Generating current affairs for ${TARGET_EXAM}`);
  if (!GEMINI_KEY) { console.error('❌ GEMINI_API_KEY not set'); process.exit(1); }

  const syllabus = loadJSON(`syllabus/${TARGET_EXAM}.json`);
  if (!syllabus?.prelims?.subjects?.length) { console.error('No syllabus'); process.exit(1); }

  const highTopics = syllabus.prelims.subjects
    .flatMap(s => s.topics.filter(t => t.weight === 'high').map(t => ({...t, subjectName: s.name})));

  for (const topic of highTopics) {
    console.log(`  📰 ${topic.name}`);
    const items = await generateCA(syllabus.examName, topic.name, topic.id);
    if (items.length > 0) {
      writeJSON(`current-affairs/${TARGET_EXAM}/${topic.id}.json`, {
        topicId: topic.id, topicName: topic.name, examId: TARGET_EXAM,
        generatedDate: today,
        isAIGenerated: true,
        disclaimer: "⚠️ AI Summary — Verify with official sources (PIB, The Hindu) before your exam.",
        items
      });
      console.log(`  ✅ ${items.length} items saved`);
    }
    await sleep(5000);
  }
  console.log('\n✅ Current affairs generation complete');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
