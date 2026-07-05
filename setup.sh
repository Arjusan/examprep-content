#!/bin/bash
# ExamPrep Content Repo — One-command GitHub push
# Run this ONCE after creating the repo on GitHub
# Usage: bash setup.sh YOUR_GITHUB_USERNAME

GITHUB_USER=${1:-"Arjusan"}
REPO_NAME="examprep-content"
REMOTE="https://github.com/${GITHUB_USER}/${REPO_NAME}.git"

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   ExamPrep Content Repo Setup Script     ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "📦 Target: ${REMOTE}"
echo ""

# Check git is installed
if ! command -v git &> /dev/null; then
  echo "❌ Git not installed. Install from https://git-scm.com"
  exit 1
fi

# Check node is installed
if ! command -v node &> /dev/null; then
  echo "❌ Node.js not installed. Install from https://nodejs.org"
  exit 1
fi

# Init repo
if [ ! -d ".git" ]; then
  echo "🔧 Initializing git repo..."
  git init
  git branch -M main
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install --silent

# Add remote if not exists
if ! git remote | grep -q origin; then
  echo "🔗 Adding remote..."
  git remote add origin "${REMOTE}"
fi

# Create placeholder files so all folders are tracked by git
echo "📁 Creating placeholder files..."

for dir in staging/si staging/icds staging/panchayat staging/tet \
           live/si live/icds live/panchayat live/tet \
           current-affairs/si current-affairs/icds current-affairs/panchayat current-affairs/tet \
           notes/icds notes/panchayat notes/tet \
           flashcards/icds flashcards/panchayat flashcards/tet \
           pyq; do
  mkdir -p "$dir"
  if [ ! -f "$dir/.gitkeep" ]; then
    touch "$dir/.gitkeep"
  fi
done

# Create initial PYQ structure for non-SI exams
for exam in icds panchayat tet; do
  if [ ! -f "pyq/${exam}.json" ]; then
    cat > "pyq/${exam}.json" << 'PYQEOF'
{
  "exam": "EXAM_PLACEHOLDER",
  "note": "PYQ bank being built. Import via Admin Panel > Question Bank > Bulk Import.",
  "questions": []
}
PYQEOF
    # Replace placeholder
    sed -i "s/EXAM_PLACEHOLDER/${exam}/g" "pyq/${exam}.json"
  fi
done

# Create syllabus placeholders for non-SI exams
for exam in icds panchayat tet; do
  if [ ! -f "syllabus/${exam}.json" ]; then
    echo '{"exam":"'${exam}'","note":"Syllabus being prepared.","prelims":{"subjects":[]}}' > "syllabus/${exam}.json"
  fi
done

# Initial commit
echo ""
echo "📝 Creating initial commit..."
git add -A
git commit -m "🚀 Initial ExamPrep content repo setup

- SI syllabus with full topic tree (10 subjects, 26 topics)
- SI notes: Polity, Freedom Struggle, Arithmetic, Reasoning
- SI flashcards: Polity (30 cards), Freedom Struggle (30 cards)
- GitHub Actions: generate-daily.yml + publish-approved.yml
- Generation scripts: generate.js, publish.js, generate-current-affairs.js
- Placeholder structure for ICDS, Panchayat, TET" 2>/dev/null || \
git commit --allow-empty -m "🚀 Initial setup"

# Push
echo ""
echo "⬆️  Pushing to GitHub..."
echo "   (You may be prompted for GitHub username + Personal Access Token)"
echo "   Get PAT at: github.com/settings/tokens/new?scopes=repo"
echo ""

git push -u origin main

if [ $? -eq 0 ]; then
  echo ""
  echo "╔══════════════════════════════════════════════════════════════╗"
  echo "║  ✅  Repo pushed successfully!                               ║"
  echo "╠══════════════════════════════════════════════════════════════╣"
  echo "║                                                              ║"
  echo "║  GitHub repo:  https://github.com/${GITHUB_USER}/${REPO_NAME}  ║"
  echo "║                                                              ║"
  echo "║  NEXT STEPS:                                                 ║"
  echo "║  1. Add GEMINI_API_KEY secret in repo Settings              ║"
  echo "║     → Settings > Secrets > Actions > New secret             ║"
  echo "║  2. Go to Actions tab — enable workflows if prompted        ║"
  echo "║  3. Run generate-daily.yml manually (Actions > Run workflow) ║"
  echo "║  4. Update FIREBASE_CONFIG in student.html + admin.html     ║"
  echo "║                                                              ║"
  echo "╚══════════════════════════════════════════════════════════════╝"
else
  echo ""
  echo "❌ Push failed. Common fixes:"
  echo "   - Make sure the repo exists on GitHub (github.com/new)"
  echo "   - Use a Personal Access Token as password"
  echo "   - Get PAT: github.com/settings/tokens/new?scopes=repo"
fi
