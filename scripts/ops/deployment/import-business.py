"""将已备份的兼容业务行导入新建专用库，保留新库真实迁移收据和空 AI 存储。"""

import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path("/home/ritiadm/nativark")
DATABASE = "nativark_dedicated_demo"
CONTAINER = "nativark-demo-mysql-1"


def configuration():
    values = {}
    for line in (ROOT / "mysql.env").read_text().splitlines():
        name, value = line.split("=", 1)
        if not value.startswith("'") or not value.endswith("'"):
            raise RuntimeError("数据库配置编码不符合部署约定")
        values[name] = value[1:-1]
    if values["MYSQL_DATABASE"] != DATABASE:
        raise RuntimeError("目标库身份不符")
    labels = json.loads(subprocess.check_output([
        "docker", "inspect", "--format", "{{json .Config.Labels}}", CONTAINER,
    ], text=True))
    if labels.get("com.docker.compose.project") != "nativark-demo":
        raise RuntimeError("目标容器身份不符")
    return values


def mysql(values, statement):
    command = ["docker", "exec", "-i", "-e", "MYSQL_PWD", CONTAINER, "mysql",
               "--default-character-set=utf8mb4", "--batch", "--raw", "--skip-column-names",
               "-u", values["MYSQL_USER"], DATABASE]
    result = subprocess.run(command, input=statement.encode(), stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE,
                            env={**os.environ, "MYSQL_PWD": values["MYSQL_PASSWORD"]})
    if result.returncode:
        private_log = ROOT / "evidence/business-import-error.log"
        private_log.write_bytes(result.stderr)
        private_log.chmod(0o600)
        raise RuntimeError("专用库命令失败，详情保留在私有错误日志")
    return result.stdout.decode().strip()


def identifier(name):
    if not re.fullmatch(r"[A-Za-z0-9_]+", name):
        raise RuntimeError("数据库标识不合法")
    return "`" + name + "`"


def inventory(values):
    raw = mysql(values, "SELECT TABLE_NAME FROM information_schema.TABLES "
                "WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME")
    tables = raw.splitlines()
    for name in tables:
        identifier(name)
    columns = {}
    for name in tables:
        raw = mysql(values, "SELECT COLUMN_NAME FROM information_schema.COLUMNS "
                    "WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='" + name + "' ORDER BY ORDINAL_POSITION")
        columns[name] = raw.splitlines()
    return {"tables": tables, "columns": columns,
            "appliedMigrations": int(mysql(values, "SELECT COUNT(*) FROM _prisma_migrations "
                                           "WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL"))}


def main():
    values = configuration()
    state = inventory(values)
    if sys.argv[1:] == ["inventory"]:
        print(json.dumps(state))
        return
    if sys.argv[1:] != ["import"] or state["appliedMigrations"] != 260:
        raise RuntimeError("导入入口或固定迁移基线不符")
    receipt = ROOT / "evidence/business-import.json"
    if receipt.exists():
        raise RuntimeError("已有导入记录，须核原操作结果后接续")
    metadata = json.loads(sys.stdin.buffer.readline(1048576))
    body = sys.stdin.buffer.read(134217729)
    if len(body) > 134217728 or hashlib.sha256(body).hexdigest() != metadata["projectionSha256"]:
        raise RuntimeError("业务投影内容摘要不一致")
    if not metadata["sourceAiContentTablesEmpty"]:
        raise RuntimeError("存在 AI 内容时须沿原恢复屏障执行")
    selected = set(metadata["rows"])
    excluded = {"_prisma_migrations", "auth_sessions", "client_auth_sessions"}
    allowed = {name for name in state["tables"] if not name.startswith("ai_") and name not in excluded}
    if selected != allowed:
        raise RuntimeError("业务表范围与固定新库不一致")
    for name in selected:
        if sorted(metadata["columns"].get(name, [])) != sorted(state["columns"][name]):
            raise RuntimeError("源库与固定新库列不兼容，停止导入")
    for name in state["tables"]:
        if name.startswith("ai_") and mysql(values, "SELECT COUNT(*) FROM " + identifier(name)) != "0":
            raise RuntimeError("新库 AI 存储已有数据，停止初始化导入")
    prepared = {"state": "prepared", "database": DATABASE,
                "productCommit": metadata["productCommit"],
                "sourceSnapshotSha256": metadata["sourceSnapshotSha256"],
                "projectionSha256": metadata["projectionSha256"], "rows": metadata["rows"]}
    receipt.write_text(json.dumps(prepared, indent=2) + "\n")
    receipt.chmod(0o600)
    statements = ["SET NAMES utf8mb4;", "SET TIME_ZONE='+00:00';",
                  "SET SQL_MODE='STRICT_ALL_TABLES,NO_AUTO_VALUE_ON_ZERO,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION';",
                  "SET FOREIGN_KEY_CHECKS=0;",
                  "START TRANSACTION;"]
    statements.extend("DELETE FROM " + identifier(name) + ";" for name in sorted(selected))
    sql = "\n".join(statements) + "\n" + body.decode("utf-8")
    sql += "\nCOMMIT;\nSET FOREIGN_KEY_CHECKS=1;\n"
    mysql(values, sql)
    for name, expected in metadata["rows"].items():
        actual = int(mysql(values, "SELECT COUNT(*) FROM " + identifier(name)))
        if actual != expected:
            raise RuntimeError("业务表行数核对失败，保持应用关闭")
    keys = mysql(values, "SELECT TABLE_NAME,CONSTRAINT_NAME,COLUMN_NAME,REFERENCED_TABLE_NAME,"
                 "REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE "
                 "WHERE TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL "
                 "ORDER BY TABLE_NAME,CONSTRAINT_NAME,ORDINAL_POSITION")
    constraints = {}
    for line in keys.splitlines():
        child, key, column, parent, parent_column = line.split("\t")
        constraints.setdefault((child, key, parent), []).append((column, parent_column))
    for (child, key, parent), columns in constraints.items():
        join = " AND ".join("c." + identifier(c) + "=p." + identifier(p) for c, p in columns)
        present = " AND ".join("c." + identifier(c) + " IS NOT NULL" for c, _ in columns)
        query = "SELECT COUNT(*) FROM " + identifier(child) + " c LEFT JOIN " + identifier(parent)
        query += " p ON " + join + " WHERE " + present + " AND p." + identifier(columns[0][1]) + " IS NULL"
        if mysql(values, query) != "0":
            raise RuntimeError("业务外键核对失败，保持应用关闭")
    prepared.update(state="verified", tables=len(selected),
                    totalRows=sum(metadata["rows"].values()), foreignKeysVerified=len(constraints),
                    aiStores="new_empty", authenticationSessions="new_login_required")
    receipt.write_text(json.dumps(prepared, indent=2) + "\n")
    print(json.dumps({key: prepared[key] for key in ["state", "tables", "totalRows", "foreignKeysVerified", "aiStores"]}))


if __name__ == "__main__":
    main()
