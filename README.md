# ShareFile 🔗

Энгийн, хурдан, **аюулгүй** file share website. Файлаа оруулахад маш богино random линк
(`https://your.site/aB3xK9q`) өгнө. Файлууд **GitHub repository**-д шифрлэгдэж хадгалагдана.

![tests](https://github.com/d3vnmd/share-file/actions/workflows/ci.yml/badge.svg)

## Боломжууд

- 📤 Drag & drop, файл сонгох, **Ctrl+V**-ээр буулгах, upload progress bar
- 🔗 **7 тэмдэгттэй** crypto-random линк (62⁷ ≈ 3.5 их наяд хувилбар)
- 🔐 Бүх файл **AES-256-GCM**-ээр шифрлэгдэж GitHub-д хадгалагдана
- 🔑 **Нууц үгтэй** бол файл таны **browser дээр** шифрлэгдэнэ (end-to-end) — сервер ч уншиж чадахгүй, линк богино хэвээрээ
- 💣 **Нэг удаа татсаны дараа устгах** (burn after download)
- ⏱ Хадгалах хугацаа: 1 цаг / 1 өдөр / 7 хоног / 30 хоног, хугацаа дуусахад автоматаар устна
- 🗑 "Миний файлууд" жагсаалт — өөрийн оруулсан файлаа хүссэн үедээ устгах
- 🌙 Dark mode, утсанд тохирсон, Монгол / English хэл
- ⌨️ `curl`-ээр ч ашиглаж болно
- Ямар ч npm dependency байхгүй

## Яаж ажилладаг вэ

```
 Browser ──HTTPS──▶  ShareFile server  ──GitHub API (token)──▶  GitHub repo (private)
                     (Cloudflare Worker                          m/<hash>        шифрлэгдсэн мэдээлэл
                      эсвэл Node.js)                             b/<exp>/<hash>  шифрлэгдсэн файл
```

GitHub token **зөвхөн сервер дээр** хадгалагдана, browser руу хэзээ ч гарахгүй.
(Тиймээс GitHub Pages шиг цэвэр static сайт хийх боломжгүй — token-оо нийтэд ил гаргана гэсэн үг.)

## Аюулгүй байдал

| Хамгаалалт | Тайлбар |
|---|---|
| Шифрлэлт | Файл бүр өөрийн гэсэн AES-256-GCM түлхүүртэй: `HKDF(MASTER_KEY, линкийн id)`. Файлын нэр, төрөл, хэмжээ зэрэг мэдээлэл ч шифрлэгдэнэ. |
| Repo-оос линк олдохгүй | Repo доторх замыг `HMAC(MASTER_KEY, id)`-оор үүсгэдэг. Repo-г бүхэлд нь харсан ч линкийг мэдэхгүй, файлыг тайлж чадахгүй. |
| End-to-end (нууц үгтэй) | Browser дээр PBKDF2-SHA256 (600,000 давталт) + AES-256-GCM. Нууц үг сервер рүү огт явахгүй. Файлын нэр ч нууцлагдана. |
| Линк таах халдлага | 62⁷ id + IP тус бүрээр олдоогүй хүсэлтийг хязгаарлана (default: минутад 20). |
| Rate limit | Upload (минутад 10), татах/харах (минутад 120) — IP тус бүрээр. |
| Upload түлхүүр | `UPLOAD_TOKEN` тохируулбал зөвхөн түлхүүртэй хүн upload хийнэ (нийтэд нээлттэй сайтад **заавал** тохируулаарай). |
| XSS | Татагдах файл үргэлж `attachment` + `application/octet-stream` + `sandbox` CSP. Хэрэглэгчийн өгөгдлийг `innerHTML`-ээр хэзээ ч гаргахгүй. |
| HTTP headers | Хатуу CSP (`default-src 'none'`), HSTS, `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` (линк гуравдагч сайт руу алдагдахгүй), `noindex`. |
| CSRF | Өөр сайтаас ирсэн upload/delete хүсэлтийг `Origin` шалгаж хаана. |
| Файлын нэр | Control тэмдэгт, bidi override (`exe.txt` хууран мэхлэлт), path separator-уудыг цэвэрлэнэ. |
| Устгах эрх | Upload хийхэд 128-bit delete token өгнө; сервер зөвхөн hash-ийг нь хадгална. |
| Бүрэн бүтэн байдал | GCM authentication — repo дахь өгөгдлийг өөрчилбөл файл "олдсонгүй" болно, хуурамч өгөгдөл хэзээ ч гарахгүй. |

## Тохируулах

### 1. Storage repo үүсгэх

GitHub дээр **private** repo үүсгэ (жишээ нь `share-file-storage`). Хоосон байж болно — сервер өөрөө эхлүүлнэ.

> Кодоо хадгалж буй энэ repo-г биш, **тусдаа private repo** ашиглахыг зөвлөж байна.

### 2. GitHub token авах

[Fine-grained personal access token](https://github.com/settings/personal-access-tokens/new) үүсгэ:

- **Repository access** → *Only select repositories* → зөвхөн `share-file-storage`
- **Permissions** → *Contents* → **Read and write** (өөр юу ч хэрэггүй)

### 3. MASTER_KEY үүсгэх

```bash
npm run keygen
```

⚠️ Энэ түлхүүрийг **хадгалж үлдээ, хэзээ ч бүү өөрчил** — өөрчилбөл хуучин бүх линк ажиллахаа болино.

### 4а. Cloudflare Workers дээр байршуулах (үнэгүй, зөвлөмж)

```bash
# wrangler.toml дотор GITHUB_REPO-г өөрийн repo болгож өөрчил
npx wrangler login
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put MASTER_KEY
npx wrangler secret put UPLOAD_TOKEN   # заавал биш, гэхдээ зөвлөж байна
npx wrangler deploy
```

Хугацаа дууссан файлуудыг цаг тутам cron автоматаар цэвэрлэнэ.

### 4б. Node.js / Docker / VPS

```bash
cp .env.example .env     # утгуудаа бөглө
npm start                # http://localhost:3000
```

Docker:

```bash
docker build -t share-file .
docker run -p 3000:3000 --env-file .env share-file
```

nginx, Render, Railway гэх мэт reverse proxy ард ажиллуулбал `TRUST_PROXY=true`, `PUBLIC_URL=https://...` тохируул.
**Production дээр заавал HTTPS** ашигла (нууц үгтэй шифрлэлт browser-т HTTPS шаарддаг).

### Локал дээр турших (GitHub-гүй)

```bash
STORAGE=memory MASTER_KEY=$(npm run -s keygen) npm start
```

## curl-ээр ашиглах

```bash
# Upload → линк буцаана (header-т X-Delete-Token ирнэ)
curl -T photo.jpg https://your.site/api/upload/
curl -T photo.jpg "https://your.site/api/upload/?expires=1h&burn=1"
curl -T photo.jpg -H "Authorization: Bearer $UPLOAD_TOKEN" https://your.site/api/upload/

# Татах
curl -OJ https://your.site/aB3xK9q/dl

# Устгах
curl -X DELETE -H "Authorization: Bearer <delete-token>" https://your.site/api/file/aB3xK9q
```

### API

| Method | Path | Тайлбар |
|---|---|---|
| `POST`/`PUT` | `/api/upload[/<нэр>]` | Body = файлын агуулга. Query: `expires` (`1h`,`1d`,`7d`,`30d`), `burn=1`, `name`, `format=json\|text`. Header: `X-File-Name`, `Authorization: Bearer <UPLOAD_TOKEN>` |
| `GET` | `/api/file/:id` | Файлын мэдээлэл (JSON) |
| `DELETE` | `/api/file/:id` | `Authorization: Bearer <deleteToken>` |
| `GET` | `/:id` | Татах хуудас |
| `GET` | `/:id/dl` | Файлыг шууд татах (`HEAD` нь burn файлыг устгахгүй) |
| `GET` | `/api/config` | Хэмжээний хязгаар, хугацааны сонголтууд |

## Тохиргоо (environment variables)

| Нэр | Default | Тайлбар |
|---|---|---|
| `GITHUB_TOKEN` | — | Storage repo-д Contents read/write эрхтэй token |
| `GITHUB_REPO` | — | `owner/repo` |
| `GITHUB_BRANCH` | `main` | Байхгүй бол автоматаар (orphan) үүсгэнэ |
| `MASTER_KEY` | — | **Заавал.** ≥32 тэмдэгт |
| `UPLOAD_TOKEN` | — | Тохируулбал upload хийхэд шаардана |
| `PUBLIC_URL` | request-ийн host | Линкэнд ашиглах домэйн |
| `TRUST_PROXY` | `false` | Proxy-н `X-Forwarded-*` header-т итгэх (Node) |
| `MAX_FILE_SIZE_MB` | `20` | 1–50 |
| `ID_LENGTH` | `7` | 5–16 тэмдэгт |
| `DEFAULT_EXPIRY` / `MAX_EXPIRY` | `1d` / `30d` | `1h`, `1d`, `7d`, `30d` |
| `RATE_LIMIT_UPLOADS` / `_REQUESTS` / `_NOT_FOUND` | `10` / `120` / `20` | IP тус бүрээр минутад |
| `STORAGE` | `github` | `memory` = зөвхөн турших |

## Хязгаарлалтууд (мэдэж байх нь зүйтэй)

- GitHub бол файл хостинг үйлчилгээ биш. Repo **~1 GB** хүртэл байхыг GitHub зөвлөдөг; API нь цагт 5,000 хүсэлт, минутад ~80 commit хязгаартай. Жижиг/дунд хэрэглээнд тохиромжтой.
- Устгасан файлууд git **history**-д шифрлэгдсэн хэлбэрээр үлддэг (MASTER_KEY болон линкгүйгээр тайлагдахгүй). Repo том болбол storage repo-гоо шинээр үүсгэж болно.
- Нэг файл дээд тал нь 50 MB (default 20 MB) — Workers-ийн 128 MB санах ойн хязгаараас шалтгаална.
- Rate limit нь process/isolate бүрийн санах ойд хадгалагддаг тул "best-effort" хамгаалалт.

## Хөгжүүлэлт

```bash
npm test     # 25 тест: API, шифрлэлт, burn, expiry, rate limit, CSRF, fake GitHub API
npm run dev  # STORAGE=memory-тэй хамт ашиглах
```

```
src/
  app.js              HTTP routes, шифрлэлт, burn/expiry/delete логик
  crypto.js           HKDF / HMAC / AES-256-GCM (Web Crypto)
  storage/github.js   GitHub Git Data API (atomic commit, conflict retry)
  server.js           Node.js entry
  worker.js           Cloudflare Workers entry (+ cron cleanup)
public/               UI (HTML/CSS/JS, dependency-гүй)
test/                 node:test тестүүд + fake GitHub API
```
