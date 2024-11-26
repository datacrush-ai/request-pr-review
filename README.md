# request-pr-review

🌏 한국어 | [**English**](README.en.md)

정해진 주기마다 슬랙으로 PR 리뷰 요청을 보내는 Github Actions

<img src=https://github.com/user-attachments/assets/a61bc6b7-fffb-449e-9c89-483a198d91ad width="500" alt="intro">

## Usage

1. 메시지 전달을 위해 `SLACK_BOT_TOKEN` 이름의 secret을 세팅하세요.

> 세팅할 Repo > Settings > Secrets > New repository secret

이때, Value는 슬랙에서 제공하는 `xoxb-` 형태의 토큰이어야 합니다.

2. `.github/workflow/request-pr-review.yml` 파일을 만드세요:

```yml
name: request pr review

on:
  schedule:
    - cron: '0 1 * * 1-5' # 평일 오전 10시마다 수행
    
jobs:
  cron:
    runs-on: [ubuntu-latest]
    steps:
      - name: Request PR Review
        uses: naver/request-pr-review@v1.2.1
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
          slackBotToken: ${{ secrets.SLACK_BOT_TOKEN }}
          repoUrl: 'https://github.com/...'
```

## Inputs

### `token`

**Required** Github에서 제공하는 토큰

### `slackBotToken`

**Required** slack bot을 통해 메시지를 보내기 위한 토큰

e.g. `xoxb-798572638592-435243279588-9aCaWNnzVYelK9NzMMqa1yxz`

### `repoUrl`

**Required** 본 액션이 적용될 Github Repo URL

e.g. `github.com/username/reponame`

## License

```
request-pr-review
Copyright (c) 2024-present NAVER Corp.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```
