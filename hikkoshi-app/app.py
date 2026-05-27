"""
一人暮らし・新社会人サポートアプリ
技術スタック: Python (Flask) + AWS DynamoDB + Yahoo路線API
"""

from flask import Flask, render_template, request, jsonify, session
import boto3
from boto3.dynamodb.conditions import Key, Attr
from botocore.exceptions import ClientError
import requests
from bs4 import BeautifulSoup
import json
import uuid
import os
from datetime import datetime, timedelta
from functools import wraps
import re

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "hikkoshi-app-secret-2024")

# ─── AWS DynamoDB 設定 ───────────────────────────────────────────────
AWS_REGION = os.environ.get("AWS_DEFAULT_REGION", "ap-northeast-1")

dynamodb = boto3.resource(
    "dynamodb",
    region_name=AWS_REGION,
    aws_access_key_id=os.environ.get("AWS_ACCESS_KEY_ID"),
    aws_secret_access_key=os.environ.get("AWS_SECRET_ACCESS_KEY"),
)

TASKS_TABLE     = "hikkoshi_tasks"
MEMOS_TABLE     = "hikkoshi_memos"
TRAIN_FAV_TABLE = "hikkoshi_train_favorites"


# ─── DynamoDBテーブル初期化 ─────────────────────────────────────────
def init_tables():
    """DynamoDBテーブルを作成（存在しない場合）"""
    client = boto3.client("dynamodb", region_name=AWS_REGION)
    existing = [t["TableName"] for t in client.list_tables()["TableNames"]]

    tables = [
        {
            "TableName": TASKS_TABLE,
            "KeySchema": [
                {"AttributeName": "user_id",  "KeyType": "HASH"},
                {"AttributeName": "task_id",  "KeyType": "RANGE"},
            ],
            "AttributeDefinitions": [
                {"AttributeName": "user_id", "AttributeType": "S"},
                {"AttributeName": "task_id", "AttributeType": "S"},
            ],
            "BillingMode": "PAY_PER_REQUEST",
        },
        {
            "TableName": MEMOS_TABLE,
            "KeySchema": [
                {"AttributeName": "user_id",  "KeyType": "HASH"},
                {"AttributeName": "memo_id",  "KeyType": "RANGE"},
            ],
            "AttributeDefinitions": [
                {"AttributeName": "user_id", "AttributeType": "S"},
                {"AttributeName": "memo_id", "AttributeType": "S"},
            ],
            "BillingMode": "PAY_PER_REQUEST",
        },
        {
            "TableName": TRAIN_FAV_TABLE,
            "KeySchema": [
                {"AttributeName": "user_id",  "KeyType": "HASH"},
                {"AttributeName": "line_name", "KeyType": "RANGE"},
            ],
            "AttributeDefinitions": [
                {"AttributeName": "user_id",  "AttributeType": "S"},
                {"AttributeName": "line_name", "AttributeType": "S"},
            ],
            "BillingMode": "PAY_PER_REQUEST",
        },
    ]

    for t in tables:
        if t["TableName"] not in existing:
            client.create_table(**t)
            print(f"Created table: {t['TableName']}")


# ─── デフォルトタスクテンプレート ──────────────────────────────────
DEFAULT_TASKS = {
    "手続き": [
        {"title": "住民票の異動届", "deadline": 14, "priority": "high", "note": "転居後14日以内に市区町村役場へ"},
        {"title": "運転免許証の住所変更", "deadline": 30, "priority": "high", "note": "警察署または運転免許センターで手続き"},
        {"title": "マイナンバーカードの住所変更", "deadline": 14, "priority": "high", "note": "住民票異動後、役場で手続き"},
        {"title": "銀行口座の住所変更", "deadline": 30, "priority": "medium", "note": "ネットバンキングでも対応可"},
        {"title": "クレジットカードの住所変更", "deadline": 30, "priority": "medium", "note": "各カード会社のサイトから"},
        {"title": "郵便局の転居届", "deadline": 7,  "priority": "high", "note": "旧住所への郵便を1年間転送"},
        {"title": "国民健康保険の手続き",  "deadline": 14, "priority": "high", "note": "社会人は勤務先の健保に加入"},
        {"title": "年金の住所変更", "deadline": 14, "priority": "medium", "note": "日本年金機構への届出"},
        {"title": "携帯電話の住所変更", "deadline": 30, "priority": "low", "note": "各キャリアのマイページから"},
        {"title": "インターネット回線の開通手続き", "deadline": -30, "priority": "high", "note": "入居1〜2ヶ月前から申込推奨"},
    ],
    "引越し作業": [
        {"title": "引越し業者の選定・見積もり",  "deadline": -60, "priority": "high", "note": "複数社から相見積もりを取る"},
        {"title": "不用品の処分・売却", "deadline": -30, "priority": "medium", "note": "フリマアプリや粗大ゴミ回収"},
        {"title": "荷造り開始（本・衣類）", "deadline": -14, "priority": "medium", "note": "使用頻度の低いものから"},
        {"title": "ライフライン（電気・ガス・水道）の開始手続き", "deadline": -7, "priority": "high", "note": "入居前日までに申込"},
        {"title": "旧居のライフライン解約",       "deadline": -3, "priority": "high", "note": "引越し日に合わせて解約"},
        {"title": "新居の掃除・傷の確認（入居前）", "deadline": 0, "priority": "high", "note": "入居前に写真を撮って記録"},
        {"title": "家具・家電の搬入・設置", "deadline": 1, "priority": "high", "note": "冷蔵庫は12〜24時間後に電源ON"},
        {"title": "ゴミ出しルールの確認", "deadline": 1, "priority": "medium", "note": "地域のゴミカレンダーを入手"},
    ],
    "生活準備": [
        {"title": "食器・調理器具の購入", "deadline": -7, "priority": "medium", "note": "100均でも十分揃えられる"},
        {"title": "寝具の準備", "deadline": -7, "priority": "high", "note": "マットレス・布団・枕"},
        {"title": "洗濯機・冷蔵庫の購入", "deadline": -30, "priority": "high", "note": "配送日を引越し日に合わせる"},
        {"title": "掃除用具の準備", "deadline": 0, "priority": "medium", "note": "掃除機・モップ・洗剤"},
        {"title": "近隣への挨拶", "deadline": 3, "priority": "medium", "note": "上下左右の部屋へ手土産を持参"},
        {"title": "緊急連絡先リストの作成", "deadline": 7, "priority": "low", "note": "管理会社・警察・消防・病院"},
        {"title": "家賃の引き落とし口座設定", "deadline": 7, "priority": "high", "note": "口座振替依頼書を管理会社へ"},
    ],
    "仕事・社会人": [
        {"title": "通勤経路・定期券の確認", "deadline": -7, "priority": "high", "note": "IC定期かモバイルSuicaか選ぶ"},
        {"title": "職場への新住所届出", "deadline": 7, "priority": "high", "note": "人事部や総務部へ"},
        {"title": "源泉徴収・社会保険の住所変更", "deadline": 14, "priority": "medium", "note": "人事担当に確認"},
        {"title": "スーツ・仕事用品の準備", "deadline": -14, "priority": "high", "note": "入社前に揃えておく"},
        {"title": "生活費・家計簿アプリの設定", "deadline": 7, "priority": "medium", "note": "MoneyForwardなど活用"},
    ],
}


# ─── ユーティリティ ─────────────────────────────────────────────────
def get_user_id():
    if "user_id" not in session:
        session["user_id"] = str(uuid.uuid4())
    return session["user_id"]


# ─── Yahoo路線情報スクレイピング ─────────────────────────────────────
def fetch_train_delay_info():
    """Yahoo路線情報から遅延情報を取得"""
    url = "https://transit.yahoo.co.jp/traininfo/area/4/"  # 関東
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        )
    }
    try:
        resp = requests.get(url, headers=headers, timeout=8)
        resp.encoding = "utf-8"
        soup = BeautifulSoup(resp.text, "html.parser")

        delays = []
        # 遅延中の路線
        delay_section = soup.find("div", class_="elmTblLstLine")
        if delay_section:
            rows = delay_section.find_all("tr")
            for row in rows:
                cols = row.find_all("td")
                if len(cols) >= 2:
                    line  = cols[0].get_text(strip=True)
                    status = cols[1].get_text(strip=True)
                    if line and status:
                        delays.append({"line": line, "status": status, "is_delay": True})

        # 正常運行のメッセージ確認
        normal_msg = soup.find("p", class_="elmTxtNormal")

        result = {
            "fetched_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
            "delays": delays,
            "all_normal": len(delays) == 0,
            "source": "Yahoo!路線情報",
            "area": "関東エリア",
        }
        return result

    except Exception as e:
        return {
            "fetched_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
            "delays": [],
            "all_normal": False,
            "error": str(e),
            "source": "Yahoo!路線情報",
        }


# ─── ルーティング ───────────────────────────────────────────────────
@app.route("/")
def index():
    user_id = get_user_id()
    return render_template("index.html", user_id=user_id)


# ── タスク API ──────────────────────────────────────────────────────
@app.route("/api/tasks", methods=["GET"])
def get_tasks():
    user_id = get_user_id()
    table = dynamodb.Table(TASKS_TABLE)
    try:
        resp = table.query(KeyConditionExpression=Key("user_id").eq(user_id))
        tasks = resp.get("Items", [])
        # カテゴリ別に整理
        categorized = {}
        for t in tasks:
            cat = t.get("category", "その他")
            categorized.setdefault(cat, []).append(t)
        return jsonify({"success": True, "tasks": categorized, "total": len(tasks)})
    except ClientError as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/tasks/init", methods=["POST"])
def init_tasks():
    """デフォルトタスクをDynamoDBに登録"""
    user_id = get_user_id()
    data = request.json or {}
    move_date_str = data.get("move_date", datetime.now().strftime("%Y-%m-%d"))

    try:
        move_date = datetime.strptime(move_date_str, "%Y-%m-%d")
    except ValueError:
        move_date = datetime.now()

    table = dynamodb.Table(TASKS_TABLE)
    added = 0

    for category, tasks in DEFAULT_TASKS.items():
        for t in tasks:
            task_id = str(uuid.uuid4())
            deadline_date = move_date + timedelta(days=t["deadline"])
            table.put_item(Item={
                "user_id":   user_id,
                "task_id":   task_id,
                "category":  category,
                "title":     t["title"],
                "note":      t["note"],
                "priority":  t["priority"],
                "deadline":  deadline_date.strftime("%Y-%m-%d"),
                "completed": False,
                "created_at": datetime.now().isoformat(),
            })
            added += 1

    return jsonify({"success": True, "added": added})


@app.route("/api/tasks", methods=["POST"])
def add_task():
    user_id = get_user_id()
    data = request.json or {}
    task_id = str(uuid.uuid4())
    table = dynamodb.Table(TASKS_TABLE)

    table.put_item(Item={
        "user_id":   user_id,
        "task_id":   task_id,
        "category":  data.get("category", "その他"),
        "title":     data.get("title", ""),
        "note":      data.get("note", ""),
        "priority":  data.get("priority", "medium"),
        "deadline":  data.get("deadline", ""),
        "completed": False,
        "created_at": datetime.now().isoformat(),
    })
    return jsonify({"success": True, "task_id": task_id})


@app.route("/api/tasks/<task_id>", methods=["PATCH"])
def update_task(task_id):
    user_id = get_user_id()
    data = request.json or {}
    table = dynamodb.Table(TASKS_TABLE)

    updates = []
    expr_vals = {}
    for key, val in data.items():
        if key not in ("user_id", "task_id"):
            updates.append(f"#{key} = :{key}")
            expr_vals[f":{key}"] = val

    if not updates:
        return jsonify({"success": False, "error": "No fields to update"}), 400

    expr_names = {f"#{k}": k for k in data.keys() if k not in ("user_id", "task_id")}

    table.update_item(
        Key={"user_id": user_id, "task_id": task_id},
        UpdateExpression="SET " + ", ".join(updates),
        ExpressionAttributeValues=expr_vals,
        ExpressionAttributeNames=expr_names,
    )
    return jsonify({"success": True})


@app.route("/api/tasks/<task_id>", methods=["DELETE"])
def delete_task(task_id):
    user_id = get_user_id()
    table = dynamodb.Table(TASKS_TABLE)
    table.delete_item(Key={"user_id": user_id, "task_id": task_id})
    return jsonify({"success": True})


# ── メモ API ────────────────────────────────────────────────────────
@app.route("/api/memos", methods=["GET"])
def get_memos():
    user_id = get_user_id()
    table = dynamodb.Table(MEMOS_TABLE)
    resp = table.query(KeyConditionExpression=Key("user_id").eq(user_id))
    return jsonify({"success": True, "memos": resp.get("Items", [])})


@app.route("/api/memos", methods=["POST"])
def add_memo():
    user_id = get_user_id()
    data = request.json or {}
    memo_id = str(uuid.uuid4())
    table = dynamodb.Table(MEMOS_TABLE)
    table.put_item(Item={
        "user_id":    user_id,
        "memo_id":    memo_id,
        "type":       data.get("type", "general"),
        "title":      data.get("title", ""),
        "content":    data.get("content", ""),
        "amount":     str(data.get("amount", "")),
        "created_at": datetime.now().isoformat(),
    })
    return jsonify({"success": True, "memo_id": memo_id})


@app.route("/api/memos/<memo_id>", methods=["DELETE"])
def delete_memo(memo_id):
    user_id = get_user_id()
    table = dynamodb.Table(MEMOS_TABLE)
    table.delete_item(Key={"user_id": user_id, "memo_id": memo_id})
    return jsonify({"success": True})


# ── 電車遅延 API ────────────────────────────────────────────────────
@app.route("/api/train-delay", methods=["GET"])
def train_delay():
    info = fetch_train_delay_info()
    return jsonify(info)


# ─── 起動 ───────────────────────────────────────────────────────────
if __name__ == "__main__":
    # init_tables()  # 初回のみ実行してください
    app.run(debug=True, host="0.0.0.0", port=5000)
