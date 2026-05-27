# 🏠 NewLife — 引越し・新社会人サポートアプリ

## 概要
一人暮らし・新社会人向けのオールインワン生活サポートアプリ。

### 主要機能
| 機能 | 説明 |
|------|------|
| 📋 タスク管理 | 手続き・引越し作業・生活準備をカテゴリ別に管理 |
| 🚆 電車遅延情報 | Yahoo!路線情報よりリアルタイム取得（5分毎自動更新） |
| 📝 生活メモ | 生活費・連絡先・重要情報を記録 |
| ✅ チェックリスト | 引越し完全チェックリスト（ローカル保存） |
| 📊 ダッシュボード | 進捗・期限・支出サマリーを一望 |

---

## 技術スタック
- **バックエンド**: Python / Flask
- **データベース**: AWS DynamoDB (NoSQL)
- **スクレイピング**: BeautifulSoup4 + Requests (Yahoo!路線情報)
- **フロントエンド**: HTML / CSS / Vanilla JS
- **本番デプロイ**: Gunicorn + AWS EC2 / Elastic Beanstalk

---

## セットアップ

### 1. 依存ライブラリのインストール
```bash
pip install -r requirements.txt
```

### 2. 環境変数の設定
```bash
cp .env.example .env
# .env を編集して AWS キーを設定
```

### 3. AWS DynamoDB テーブルの作成
```bash
python setup_aws.py
```
> ⚠️ AWS の権限: DynamoDB の CreateTable, PutItem, GetItem, Query, UpdateItem, DeleteItem が必要

### 4. アプリ起動
```bash
# 開発環境
python app.py

# 本番環境 (Gunicorn)
gunicorn app:app -w 4 -b 0.0.0.0:5000
```

ブラウザで `http://localhost:5000` を開く

---

## AWS DynamoDB テーブル設計

### hikkoshi_tasks
| 属性 | 型 | 説明 |
|------|-----|------|
| user_id (PK) | String | セッションID |
| task_id (SK) | String | UUID |
| category | String | 手続き/引越し作業/生活準備/仕事 |
| title | String | タスク名 |
| deadline | String | 期限日 (YYYY-MM-DD) |
| priority | String | high/medium/low |
| completed | Boolean | 完了フラグ |
| note | String | 補足メモ |

### hikkoshi_memos
| 属性 | 型 | 説明 |
|------|-----|------|
| user_id (PK) | String | セッションID |
| memo_id (SK) | String | UUID |
| type | String | expense/contact/important/general |
| title | String | タイトル |
| amount | String | 金額（費用の場合） |
| content | String | メモ内容 |

### hikkoshi_train_favorites
| 属性 | 型 | 説明 |
|------|-----|------|
| user_id (PK) | String | セッションID |
| line_name (SK) | String | 路線名 |

---

## 電車遅延情報について
- データソース: Yahoo!路線情報 (https://transit.yahoo.co.jp/traininfo/area/4/)
- エリア: 関東（東京・神奈川・千葉・埼玉）
- 更新頻度: アプリ内で5分ごとに自動更新
- ⚠️ スクレイピング利用のため、Yahoo!の利用規約に従ってください

---

## デプロイ (AWS EC2)
```bash
# EC2インスタンス上で
git clone <your-repo>
cd hikkoshi-app
pip install -r requirements.txt
cp .env.example .env  # AWS IAM ロールがあれば不要
python setup_aws.py
gunicorn app:app -w 4 -b 0.0.0.0:80 --daemon
```

> EC2 に IAM ロール (DynamoDB アクセス権) をアタッチすれば
> `.env` の AWS キー設定は不要です。
