// github-issue — petit client pour poster un commentaire sur l'issue de
// suivi des signalements (data-coeur/ecg-pipeline#3). Lit GITHUB_TOKEN
// depuis l'env ; échoue silencieusement si absent (le report local
// fonctionne quand même).
// Appelé par routes/report. Raison : isoler l'appel à l'API GitHub.

const GITHUB_REPO = 'data-coeur/ecg-pipeline';
const GITHUB_ISSUE = 3;

function getGithubToken(): string | null {
  return process.env.GITHUB_TOKEN || null;
}

export async function postGithubComment(body: string): Promise<void> {
  const token = getGithubToken();
  if (!token) {
    console.warn('[Report] No GitHub token, skipping issue comment');
    return;
  }
  try {
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/issues/${GITHUB_ISSUE}/comments`,
      {
        method: 'POST',
        headers: { Authorization: `token ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      },
    );
    if (!response.ok) console.warn(`[Report] GitHub comment failed: ${response.status}`);
    else console.log('[Report] GitHub issue comment posted');
  } catch (error) {
    console.warn('[Report] GitHub comment error:', error);
  }
}
