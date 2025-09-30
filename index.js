// Request PR Review (team-channel + shared mapping + Levi tone with pending/remaining split + morning greeting)
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

/** ======================== */

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

// 매핑 우선, 없으면 GitHub 로그인으로 멘션 시도
function buildMentionsForPR(pr, map) {
  const reviewers = pr.requested_reviewers || [];
  const tags = reviewers.map((u) => {
    const login = u.login;             // GitHub 아이디
    const slackId = map[login];        // .github/slack-map.json 에 저장된 Slack UID (UXXXX…)
    return slackId ? `<@${slackId}>`   // 매핑이 있으면 UID로 정확 멘션
                   : `<@${login}>`;    // 매핑이 없으면 로그인으로 멘션 시도
  });
  return tags.filter(Boolean).join(' ');
}

// 여러 PR의 멘션을 상단 메시지에 한번만 모아 붙이기
function aggregateMentions(items) {
  const set = new Set();
  for (const it of items) {
    const ms = (it.mentions || '').split(/\s+/).filter(Boolean);
    for (const m of ms) set.add(m);
  }
  return Array.from(set).join(' ');
}

// 리바이 톤 A/B/C/D 중 랜덤
function pickLeviHeader({ mentions, repoFullName }) {
  const withMention = mentions ? `${mentions} ` : ''; // 멘션이 있으면 앞에 붙임
  const variants = [
    `${withMention}${repoFullName} 리뷰 요청 목록이다. 지체하지 말고 바로 확인해라.`, // A
    `${withMention}${repoFullName} 리뷰가 밀려 있다. 시간 끌면 머지와 릴리스가 늦어진다. 지금 처리해라.`, // B
    `${withMention}리뷰 요청이다. 빠르게 확인하고 대응하라.`, // C
    `${withMention}리뷰 요청이다. 게을러지지 마라. 당장 확인해라.` // D
  ];
  const keys = ['A', 'B', 'C', 'D'];
  const idx = Math.floor(Math.random() * variants.length);
  return { headerText: variants[idx], variantKey: keys[idx] };
}

// 공통 블록 빌더 (greetingText 옵션 추가)
function buildListBlocks(headerText, items, opts = { withContext: true, greetingText: '' }) {
  if (items.length === 0) {
    const emptyMsg = '✅ 지금은 리뷰할 PR이 없다. 방심하지 마라. 곧 또 생길 거다.';
    const prefix = opts.greetingText ? `${opts.greetingText}\n` : '';
    return [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `${prefix}${emptyMsg}` }
      }
    ];
  }

  const blocks = [{ type: 'section', text: { type: 'mrkdwn', text: headerText } }];

  for (const it of items) {
    const isUrgent = (it.labels || []).some((l) => l.name === 'D-0');
    // ===== 👇 수정된 부분: 요청하신 고정 멘트로 변경 =====
    const urgentText = isUrgent ? ' 🚨 *긴급 PR이다. 지금 처리해라.*' : '';

    // 1. 아이템의 제목, 멘션, URL을 'section' 블록으로 추가합니다.
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `• ${it.mentions || ''} <${it.url}|${encodeText(it.title)}>${urgentText}`
      }
    });
  
    // 2. 라벨이 있는 경우, 요청하신 형식의 'actions' 블록으로 버튼들을 추가합니다.
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

  if (opts.withContext) {
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: '⚠️ 리뷰를 미루면 머지와 릴리스가 늦어진다. 쓸데없는 변명 말고, 당장 피드백해라.'
        }
      ]
    });
  }

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

    // items에 requested_count를 같이 넣어 분기 근거로 사용
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

    // 분리: 아직 리뷰 안 끝난 PR(pending) vs 리뷰는 끝났으나 머지 안 된 PR(remaining)
    const pendingItems = items.filter((it) => it.requested_count > 0);
    const remainingItems = items.filter((it) => it.requested_count === 0);

    let textSummary = '';
    let blocks = [];

    if (pendingItems.length > 0) {
      // 아직 리뷰가 남아있음 → A/B/C/D 랜덤 + 멘션 집계 + 인사
      const topMentions = aggregateMentions(pendingItems);
      const { headerText, variantKey } = pickLeviHeader({
        mentions: topMentions,
        repoFullName: `${owner}/${repo}`
      });
      core.info(`Levi header (pending) variant = ${variantKey}`);
      const greeting = pickMorningGreeting();
      const pendingHeader = `${greeting} ${headerText}`;
      textSummary = pendingHeader;
      blocks = buildListBlocks(pendingHeader, pendingItems, { withContext: true });
    } else if (remainingItems.length > 0) {
      // 리뷰는 끝났으나 머지 안 됨 → 남은 PR만 정리 + 인사
      const greeting = pickMorningGreeting();
      const headerText = `리뷰는 끝났다. 남은 PR을 마무리해라.`;
      const remainingHeader = `${greeting} ${headerText}`;
      textSummary = remainingHeader;
      blocks = buildListBlocks(remainingHeader, remainingItems, { withContext: false });
    } else {
      // 오픈 PR 자체가 없음 → 인사 + 빈 메시지 블록
      const greeting = pickMorningGreeting();
      textSummary = `${greeting} 리뷰 대기 PR 없음`;
      blocks = buildListBlocks('', [], { withContext: false, greetingText: greeting });
    }

    const res = await slack.post('/chat.postMessage', {
      channel: CHANNEL,
      text: textSummary,
      blocks
    });
    core.info(`Slack response: ${JSON.stringify(res.data)}`);
    if (!res.data?.ok) {
      throw new Error(`Slack error: ${res.data?.error || 'unknown_error'} (channel=${CHANNEL})`);
    }

    core.notice(
      `Sent request-pr-review for ${owner}/${repo} (pending=${pendingItems.length}, remaining=${remainingItems.length})`
    );
  } catch (e) {
    core.setFailed(e.message);
  }
})();
