# Homework Progress App

教育用の課題進捗・理解度・教材管理アプリです。

## 構成

- `frontend/`: Next.js フロントエンド
- `backend/`: Express + PostgreSQL バックエンド
- `db/`: SQL スキーマ
- `docker/`: 開発用 PostgreSQL の例

## 公開リポジトリ化にあたって

このリポジトリには以下を含めません。

- `.env` / `.env.local`
- `node_modules`
- `.next`
- `backend/uploads/`

セットアップ時は、各ディレクトリの `.env.example` をコピーして `.env` または `.env.local` を作成してください。

## バックエンド起動

```bash
cd backend
npm install
cp .env.example .env
node server.js
```

## フロントエンド起動

```bash
cd frontend
# package.json がある環境で npm install
cp .env.example .env.local
npm run dev
```

## 重要メモ

- 公開前に `JWT_SECRET` を必ず変更してください。
- PostgreSQL 接続情報は `.env` に置いてください。
- `backend/uploads/` はサーバー側で作成してください。
