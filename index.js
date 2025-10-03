// Request PR Review (team-channel + shared mapping + Levi tone + morning greeting)
// Apache-2.0

const core = require('@actions/core');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

/** ===== 팀별 커스텀: 채널/매핑 파일 경로만 수정 ===== */
const CHANNEL = 'C09HMH5CHS4';                 // 팀 채널 ID (또는 '#channel-name')
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

function pickMorningGreeting() {
  const variants = [
    '좋은 아침이다. 정신 차려라.',
    '아침이다. 게을러지지 마라.',
    '좋은 아침이다. 오늘도 심장을 바쳐라.',
    '일과는 시작됐다. 바로 움직여라.'
  ];
  return variants[Math.floor(Math.random() * variants.length)];
}

function loadSlackMap() {
  try {
    const full = path.resolve(process.cwd(), MAP_PATH);
    return JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch (e) {
    core.warning(`Slack map not found or invalid at ${MAP_PATH}: ${e.message}`);
    return {};
  }
}

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
  const tags = reviewers.map((u) => {
    const login = u.login;
    const slackId = map[login];
    return slackId ? `<@${slackId}>` : `<@${login}>`;
  });
  return tags.filter(Boolean).join(' ');
}

function aggregateMentions(items) {
  const set = new Set();
  for (const it of items) {
    const ms = (it.mentions || '').split(/\s+/).filter(Boolean);
    for (const m of ms) set.add(m);
  }
  return Array.from(set).join(' ');
}

function pickLeviHeader({ mentions, repoFullName }) {
  const withMention = mentions ? `${mentions} ` : '';
  const variants = [
    `${withMention}${repoFullName} 리뷰 요청 목록이다. 지체하지 말고 바로 확인해라.`,
    `${withMention}${repoFullName} 리뷰가 밀려 있다. 시간 끌면 머지와 릴리스가 늦어진다. 지금 처리해라.`,
    `${withMention}리뷰 요청이다. 빠르게 확인하고 대응하라.`,
    `${withMention}리뷰 요청이다. 게을러지지 마라. 당장 확인해라.`
  ];
  const keys = ['A', 'B', 'C', 'D'];
  const idx = Math.floor(Math.random() * variants.length);
  return { headerText: variants[idx], variantKey: keys[idx] };
}

// 모든 PR을 한 메시지에 나열
function buildAllPRBlocks(headerText, items) {
  if (items.length === 0) {
    return [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `✅ 지금은 리뷰할 PR이 없다. 방심하지 마라. 곧 또 생길 거다.` }
      }
    ];
  }

  const blocks = [{ type: 'section', text: { type: 'mrkdwn', text: headerText } }];

  for (const it of items) {
    const isUrgent = (it.labels || []).some((l) => l.name === 'D-0');
    const urgentText = isUrgent ? ' 🚨 *긴급 PR이다. 지금 처리해라.*' : '';

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `• ${it.mentions || ''} <${it.url}|${encodeText(it.title)}>${urgentText}`
      }
    });

    const labels = it.labels || [];
    if (labels.length > 0) {
      blocks.push({
        type: 'actions',
        elements: labels.map(({ name }) => ({
          type: 'button',
          text: {
            type: 'plain_text',
            text: name,
            emoji: true
          },
          ...(name === 'D-0' ? { style: 'danger' } : {})
        }))
      });
    }
  }

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: '⚠️ 리뷰를 미루면 머지와 릴리스가 늦어진다. 쓸데없는 변명 말고, 당장 피드백해라.'
      }
    ]
  });

  return blocks;
}

(async () => {
  try {
    core.info(`Slack channel target = ${CHANNEL}`);
    core.info(`Has SLACK_BOT_TOKEN = ${!!core.getInput('slackBotToken')}`);

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
        mentions: buildMentionsForPR(pr, map),
        requested_count: (pr.requested_reviewers || []).length
      }))
      .sort((a, b) => a.number - b.number);

    const topMentions = aggregateMentions(items);
    const { headerText, variantKey } = pickLeviHeader({
      mentions: topMentions,
      repoFullName: `${owner}/${repo}`
    });
    core.info(`Levi header variant = ${variantKey}`);

    const greeting = pickMorningGreeting();
    const header = `${greeting} ${headerText}`;

    const blocks = buildAllPRBlocks(header, items);

    const res = await slack.post('/chat.postMessage', {
      channel: CHANNEL,
      text: header,
      blocks
    });
    core.info(`Slack response: ${JSON.stringify(res.data)}`);
    if (!res.data?.ok) {
      throw new Error(`Slack error: ${res.data?.error || 'unknown_error'} (channel=${CHANNEL})`);
    }

    core.notice(`Sent request-pr-review for ${owner}/${repo} (count=${items.length})`);
  } catch (e) {
    core.setFailed(e.message);
  }
})();
