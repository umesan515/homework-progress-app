# UMENOTE 開発引継ぎ README

## 開発方式

本プロジェクトはZIP置き換え方式で開発する。

### 手順

1. ChatGPTがZIP出力
2. unzip -o で展開
3. build
4. pm2 restart
5. 動作確認
6. Git push

* * *

## サーバー構成

Frontend: Next.js (PM2)

Backend: Express (PM2)

Tunnel: Cloudflare Tunnel

Domain: https://umenote.jp

* * *

## ログイン確認用

管理者アカウントのID・パスワードは公開READMEには記載しない。

教師: teacher1 / teachpass

生徒: student01 / studpass

* * *

## build手順

cd frontend
rm -rf .next
npm run build

cd ..
pm2 restart homework-app --update-env
pm2 restart homework-api

* * *

## 開発ルール

・既存デザインを崩さない
・UI統一ルールを守る
・不要変更禁止
・ZIP単位修正
・見出しとなる大きな文字は灰色背景の枠（bg-gray-50）の外に配置する
・ユーザーが了承した最新コードを基準に継続開発し、過去版へ戻さない

* * *

## 現在の開発段階

管理者機能基盤完成

次工程:

生徒管理機能の完成
