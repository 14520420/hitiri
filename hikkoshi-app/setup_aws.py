"""
DynamoDBテーブル初期化スクリプト
使い方: python setup_aws.py
"""

import boto3
import os
from dotenv import load_dotenv

load_dotenv()

AWS_REGION = os.environ.get("AWS_DEFAULT_REGION", "ap-northeast-1")

client = boto3.client(
    "dynamodb",
    region_name=AWS_REGION,
    aws_access_key_id=os.environ.get("AWS_ACCESS_KEY_ID"),
    aws_secret_access_key=os.environ.get("AWS_SECRET_ACCESS_KEY"),
)

TABLES = [
    {
        "TableName": "hikkoshi_tasks",
        "KeySchema": [
            {"AttributeName": "user_id", "KeyType": "HASH"},
            {"AttributeName": "task_id", "KeyType": "RANGE"},
        ],
        "AttributeDefinitions": [
            {"AttributeName": "user_id", "AttributeType": "S"},
            {"AttributeName": "task_id", "AttributeType": "S"},
        ],
        "BillingMode": "PAY_PER_REQUEST",
        "Tags": [{"Key": "Project", "Value": "hikkoshi-app"}],
    },
    {
        "TableName": "hikkoshi_memos",
        "KeySchema": [
            {"AttributeName": "user_id", "KeyType": "HASH"},
            {"AttributeName": "memo_id", "KeyType": "RANGE"},
        ],
        "AttributeDefinitions": [
            {"AttributeName": "user_id", "AttributeType": "S"},
            {"AttributeName": "memo_id", "AttributeType": "S"},
        ],
        "BillingMode": "PAY_PER_REQUEST",
        "Tags": [{"Key": "Project", "Value": "hikkoshi-app"}],
    },
    {
        "TableName": "hikkoshi_train_favorites",
        "KeySchema": [
            {"AttributeName": "user_id",  "KeyType": "HASH"},
            {"AttributeName": "line_name", "KeyType": "RANGE"},
        ],
        "AttributeDefinitions": [
            {"AttributeName": "user_id",  "AttributeType": "S"},
            {"AttributeName": "line_name", "AttributeType": "S"},
        ],
        "BillingMode": "PAY_PER_REQUEST",
        "Tags": [{"Key": "Project", "Value": "hikkoshi-app"}],
    },
]


def create_tables():
    existing = client.list_tables()["TableNames"]
    for t in TABLES:
        name = t["TableName"]
        if name in existing:
            print(f"  ✅ {name} — 既に存在します")
        else:
            client.create_table(**t)
            waiter = client.get_waiter("table_exists")
            waiter.wait(TableName=name)
            print(f"  🆕 {name} — 作成完了")


if __name__ == "__main__":
    print("🚀 AWS DynamoDB テーブルを初期化中...")
    create_tables()
    print("✨ セットアップ完了！")
    print("\n次のステップ:")
    print("  python app.py  — 開発サーバーを起動")
    print("  gunicorn app:app -w 4 -b 0.0.0.0:5000  — 本番起動")
