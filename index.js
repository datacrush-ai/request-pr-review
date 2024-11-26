// request-pr-review
// Copyright (c) 2024-present NAVER Corp.
// Apache-2.0

const core = require("@actions/core");
const axios = require("axios");

const D0 = "D-0";
const ENCODE_PAIR = {
    "<": "&lt;",
    ">": "&gt;"
};
const encodeText = text => text.replace(/[<>]/g, matched => ENCODE_PAIR[matched]);
const authFetch = url => axios({
    method: "get",
    headers: {
        Authorization: `token ${core.getInput("token")}`
    },
    url
}).then(res => res.data);
const createRequestPRData = (user) => ({
    text: "좋은 아침이에요 :wave:",
    blocks: [
        {
            type: "section",
            text: {
                type: "mrkdwn",
                text: "👋 좋은 아침입니다"
            }
        },
        {
            type: "section",
            text: {
                type: "mrkdwn",
                text: `🙏 <@${user.name}> 님의 리뷰를 애타게 기다리는 동료의 PR이 있어요. 리뷰에 참여해 주세요:`
            }
        },
        {
            type: "section",
            text: {
                type: "mrkdwn",
                text: user.requestedPRs
                    .map(({title, url, labels}) => {
                        let text = `• <${url}|${encodeText(title)}>`;

                        if (labels.some(({name}) => name === D0)) {
                            text += `\n\t• ☝️PR은 \`${D0}\` PR로 매우 긴급한 PR입니다. 🚨 지금 바로 리뷰에 참여해 주세요.`
                        }

                        return text;
                    })
                    .join("\n")
            }
        }
    ]
});
/**
 * @param {User} user
 * @param {object} data
 */
const sendSlack = (user, data) => axios({
    method: "post",
    headers: {
        Authorization: `Bearer ${core.getInput("slackBotToken")}`,
        "Content-Type": "application/json"
    },
    url: "https://slack.com/api/chat.postMessage",
    data: {
        channel: `@${user.name}`,
        ...data
    }
});

class Pull {
    /**
     * @type {{[key: string]: Pull}}
     * @private
     */
    static _instances = {};

    /**
     * @param {{title: string, html_url: string, number: number, labels: {name: string}[]}} pullInfo
     * @returns {Pull}
     */
    static create(pullInfo) {
        const {html_url: url} = pullInfo;

        return Pull._instances[url] || (Pull._instances[url] = new Pull(pullInfo));
    }

    /**
     * @param {{title: string, html_url: string, number: number, labels: {name: string}[]}} pullInfo
     * @returns {Pull}
     */
    constructor(pullInfo) {
        const {title, html_url, number, labels} = pullInfo;

        this._title = title;
        this._url = html_url;
        this._number = number;
        this._labels = labels;
    }

    get title() {
        return this._title;
    }

    get url() {
        return this._url;
    }

    get number() {
        return this._number;
    }

    get labels() {
        return this._labels;
    }
}

class User {
    /**
     * @returns {User[]}
     */
    static getUsers() {
        return Object.values(User._instances);
    }

    /**
     * @type {{[key: string]: User}}
     * @private
     */
    static _instances = {};

    /**
     * @param {{login: string, email: string}} userInfo
     * @returns {User}
     */
    static create(userInfo) {
        const {email} = userInfo;

        return User._instances[email] || (User._instances[email] = new User(userInfo));
    }

    constructor(userInfo) {
        const {login, email} = userInfo;

        /**
         * @type {string}
         * @private
         */
        this._login = login;
        this._email = email;
        /**
         * @type {Pull[]}
         * @private
         */
        this._requestedPRs = [];
    }

    get login() {
        return this._login;
    }

    get name() {
        return this._email ? this._email.split("@")[0] : null;
    }

    get requestedPRs() {
        return this._requestedPRs;
    }

    /**
     * @param {Pull} pull
     */
    requestReview(pull) {
        this._requestedPRs.push(pull);
    }
}

const refineToApiUrl = repoUrl => {
    const enterprise = !repoUrl.includes("github.com");
    const [host, pathname] = repoUrl
        .replace(/^https?:\/\//, "")
        .replace(/\/$/, "")
        .split(/\/(.*)/); // github.com/abc/def -> ['github.com', 'abc/def', '']

    if (enterprise) {
        return `https://${host}/api/v3/repos/${pathname}`;
    }

    return `https://api.${host}/repos/${pathname}`;
};

(async () => {
    try {
        const BASE_API_URL = refineToApiUrl(core.getInput("repoUrl"));

        core.info(`Running for: ${BASE_API_URL}`);

        const fetchPulls = () => authFetch(`${BASE_API_URL}/pulls`);
        const fetchReviewers = number => authFetch(`${BASE_API_URL}/pulls/${number}/requested_reviewers`)
            .then(({users/* , teams */}) => users); // 팀 단위로 리뷰를 요청한 경우는 고려하지 않는다
        const fetchUser = url => authFetch(url);

        core.info("Fetching pulls...");

        for (const pullInfo of await fetchPulls()) {
            const pull = Pull.create(pullInfo);

            core.info(`Fetching reviewers of #${pull.number}...`);

            for (const reviewer of await fetchReviewers(pull.number)) {
                const userInfo = await fetchUser(reviewer.url);

                core.info(`Creating a user instance for\n${JSON.stringify(userInfo, null, 2)}`);

                const user = User.create(userInfo);

                user.requestReview(pull);
            }
        }

        const users = User.getUsers();

        core.info("Starting sending messages...");

        await Promise.all(users.map(user => {
            if (!user.name) {
                core.warning(`'${user.login}' has no public email.`);
                return;
            }

            core.info(`Sending a message to ${user.name}...`);

            return sendSlack(user, createRequestPRData(user));
        }));

        core.info("Messages sent successfully");
    } catch (e) {
        core.setFailed(e.message);
    }
})();
