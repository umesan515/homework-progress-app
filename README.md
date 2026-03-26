# homework-progress-app

学習進捗管理アプリのリポジトリです．

## 現在のフォルダ構造

- `frontend/` : Next.js フロントエンド
- `backend/` : Node.js / Express API
- `db/` : DB 初期化用SQLなど
- `docker/` : docker / compose 関連
- `docs/` : 補助資料置き場

## 開発時の基本コマンド

### frontend

```bash
cd frontend
npm install
npm run build
```

### backend

```bash
cd backend
npm install
node --check server.js
node server.js
```

## 注意

- 今後の正本は `frontend/` と `backend/` です．
- ルートの `lib/` は使用しません．
