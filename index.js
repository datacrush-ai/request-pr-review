// Request PR Review (team-channel + shared mapping)
// Forked customization to share mapping with notify-pr-review
// Apache-2.0

const core = require('@actions/core');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

/** ===== 팀별 커스텀: 채널명/매핑 파일 경로만 수정 ===== */
const CHANNEL = '#뷰링고-fe-github';                 // 팀 채널 고정
const MAP_PATH = '.github/slack-map.json';      // 서비스 리포 내 공유 JSON
/** =============================================== */

const ENCODE_PAIR = { '<': '&lt;', '>': '&gt;' };
const encodeText = (t) => t.replace(/[<>]/g, (m) => ENCODE_PAIR[m]);

const gh = axios.create({
  baseURL: 'https://api.github.com',
  headers: { Authorization: `token ${core.getInput('token')}` }
});

const slack = axios.create({
  baseURL: 'https://slack.com/api',
  headers: {
    Authorization: `Bearer ${core.getInput('slackBotToken')}`,
    'Content-Type': 'application/json'
  }
});

function loadSlackMap() {
  try {
    const full = path.resolve(process.cwd(), MAP_PATH);
    return JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch (e) {
    core.warning(`Slack map not found or invalid at ${MAP_PATH}: ${e.message}`);
    return {};
  }
}

// https://github.com/org/repo → { owner, repo }
function parseRepoUrl(repoUrl) {
  const m = repoUrl.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (!m) throw new Error(`Invalid repoUrl: ${repoUrl}`);
  return { owner: m[1], repo: m[2] };
}

async function listOpenPRs(owner, repo) {
  const prs = [];
  let page = 1;
  while (true) {
    const { data } = await gh.get(`/repos/${owner}/${repo}/pulls`, {
      params: { state: 'open', per_page: 50, page }
    });
    prs.push(...data);
    if (data.length < 50) break;
    page += 1;
  }
  const skipDraft = core.getInput('skipDraft') === 'true';
  return prs.filter((pr) => (skipDraft ? !pr.draft : true));
}

function buildMentionsForPR(pr, map) {
  const reviewers = pr.requested_reviewers || [];
  const ids = reviewers
    .map((u) => map[u.login])
    .filter(Boolean)
    .map((uid) => `<@${uid}>`);
  return ids.join(' ');
}

function buildSlackBlocks(repoFullName, items) {
  if (items.length === 0) {
    return [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: '🎉 현재 리뷰 대기 중인 PR이 없습니다!' }
      }
    ];
  }

  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${repoFullName}* 리뷰 요청 목록입니다. 가능한 빠르게 확인 부탁드려요 🙏`
      }
    },
    { type: 'divider' }
  ];

  for (const it of items) {
    const labelText =
      (it.labels || []).length > 0
        ? `\n라벨: ${it.labels.map((l) => `\`${l.name}\``).join(' ')}`
        : '';

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `• ${it.mentions || ''} <${it.url}|${encodeText(it.title)}>${labelText}`
      }
    });
  }

  blocks.push({ type: 'divider' });
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: '💡 리뷰 지연은 머지/릴리스 주기를 늘립니다. 가벼운 코멘트라도 빠르게 남겨주세요!'
      }
    ]
  });

  return blocks;
}

(async () => {
  try {
    const repoUrl = core.getInput('repoUrl');
    if (!repoUrl) throw new Error('`repoUrl` input is required');

    const { owner, repo } = parseRepoUrl(repoUrl);
    const map = loadSlackMap();

    const prs = await listOpenPRs(owner, repo);

    const items = prs
      .map((pr) => ({
        number: pr.number,
        title: pr.title,
        url: pr.html_url,
        labels: pr.labels || [],
        mentions: buildMentionsForPR(pr, map)
      }))
      .sort((a, b) => a.number - b.number);

    await slack.post('/chat.postMessage', {
      channel: CHANNEL,
      text: items.length === 0 ? '리뷰 대기 PR 없음' : `리뷰 요청: ${items.length}건`,
      blocks: buildSlackBlocks(`${owner}/${repo}`, items)
    });

    core.notice(
      `Sent request-pr-review for ${owner}/${repo} with ${items.length} items`
    );
  } catch (e) {
    core.setFailed(e.message);
  }
})();
