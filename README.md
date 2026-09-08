# FortuneLight Server

DB와 사용자 세션 없이, 3대 내외의 FortuneLight Unity 클라이언트를 조율하는
단일 Node.js 서버입니다. 각 QR은 같은 웹페이지를 열되 짧은 화면 번호 경로로 클라이언트를 구분합니다.

```text
https://fortune.cherryplum.net/1
https://fortune.cherryplum.net/2
https://fortune.cherryplum.net/3
https://fortune.cherryplum.net/4
```

기존 `/?station=by-fortune-light-01` 형식도 계속 사용할 수 있습니다.

## 동작 원칙

- 서버 시작 시 모든 클라이언트는 `unknown`입니다.
- Unity heartbeat가 `idle`을 보고한 클라이언트만 입력을 받습니다.
- 제출 순간 서버가 메모리 상태를 동기적으로 `idle → reserved`로 변경합니다.
- 같은 클라이언트에 동시에 제출해도 최초 요청 하나만 성공합니다.
- Unity는 `reserved → loading → showing → idle` 순서로 상태를 보고합니다.
- `idle` 복귀 시 생년월일을 즉시 메모리에서 삭제합니다.
- 서버 재시작 시 진행 데이터가 사라지는 것은 현재 운영 정책상 허용합니다.
- 입력마다 임시 `inputId`를 부여해 이중 터치·응답 재수신에 따른 중복 연출을 막고,
  `idle` 복귀 시 생년월일과 함께 삭제합니다.

## 로컬 실행

Node.js 20 이상이 필요합니다. 외부 npm 패키지는 없습니다.

```bash
npm test
npm start
```

개발 기본 키를 사용하는 대신 운영 환경에서는 `.env.example`을 `.env`로 복사한 뒤
클라이언트별 키를 변경합니다. 서버 코드 자체는 `.env`를 읽지 않으며,
`ecosystem.config.cjs`가 PM2 실행 시 해당 값을 환경변수로 주입합니다.

## API

### Web

- `GET /api/stations/:stationId/status`
- `POST /api/stations/:stationId/claim`

Claim body:

```json
{ "birthDate": "1995-08-21" }
```

### Unity

다음 API에는 `Authorization: Bearer <apiKey>`가 필요합니다.

- `POST /api/clients/:clientId/heartbeat`
- `GET /api/clients/:clientId/current`
- `POST /api/clients/:clientId/state`

Heartbeat/state body:

```json
{ "status": "idle" }
```

## Lightsail 배포 형태

권장 구성은 Lightsail 512MB 인스턴스의 Nginx 뒤에서 PM2 단일 fork 프로세스로
실행하는 것입니다. Nginx가 정적 페이지와 `/api` 요청을 모두 이 서버로 전달하면
별도 CORS 구성이 필요 없습니다.

프로덕션에서는 다음을 적용합니다.

- `NODE_ENV=production`
- 충분히 긴 클라이언트별 API 키
- Nginx HTTPS와 Let's Encrypt
- PM2 로그 로테이션
- Lightsail 방화벽에서 80/443만 공개하고 SSH 접근 제한
- PM2 cluster mode 미사용

### Lightsail 최초 설치

```bash
sudo apt update
sudo apt install -y nginx git

# Node.js 20과 PM2를 설치한 뒤 실행
git clone https://github.com/JadeCherryplum/fortune-relay-server.git
cd fortune-relay-server
cp .env.example .env
nano .env
npm test
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

`pm2 startup`이 출력하는 `sudo ...` 명령은 한 번 실행해야 합니다.

### 이후 업데이트

```bash
cd ~/fortune-relay-server
git pull --ff-only
npm test
pm2 restart ecosystem.config.cjs --update-env
```
