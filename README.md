# UMENOTE 開発引継ぎ README

## 開発方式

本プロジェクトはZIP置き換え方式で開発する。

### 手順

1.  ChatGPTがZIP出力
2.  unzip -o で展開
3.  build
4.  pm2 restart
5.  動作確認
6.  Git push

------------------------------------------------------------------------

## サーバー構成

Frontend: Next.js (PM2)

Backend: Express (PM2)

Tunnel: Cloudflare Tunnel

Domain: https://umenote.jp

------------------------------------------------------------------------

## ログイン確認用

管理者: umehara / yuki0515

教師: teacher1 / teachpass

生徒: student01 / studpass

------------------------------------------------------------------------

## build手順

cd frontend rm -rf .next npm run build

cd .. pm2 restart homework-app –update-env pm2 restart homework-api

------------------------------------------------------------------------

## 開発ルール

・既存デザインを崩さない ・UI統一ルールを守る ・不要変更禁止
・ZIP単位修正

------------------------------------------------------------------------

## 現在の開発段階

管理者機能基盤完成

次工程:

生徒管理機能の完成
