"""比较原服务身份与 Nginx 配置，新增容器仅接受本次 Nativark 项目。"""

import argparse
import hashlib
import http.client
import json
from pathlib import Path
import subprocess


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline", type=Path, required=True)
    options = parser.parse_args()
    baseline = json.loads(options.baseline.read_text())
    processes = {}
    for directory in Path("/proc").iterdir():
        if not directory.name.isdigit():
            continue
        try:
            name = (directory / "comm").read_text().strip()
            if name in ("java", "nginx", "redis-server"):
                start = (directory / "stat").read_text().rsplit(")", 1)[1].split()[19]
                processes[directory.name] = {"name": name, "start": start}
        except FileNotFoundError:
            continue
    for pid, identity in baseline["processes"].items():
        # 原负责人已允许并行 Java 更新，原 Nginx／Redis 仍须身份一致。
        if identity["name"] != "java" and processes.get(pid) != identity:
            raise RuntimeError("原服务进程身份发生变化")

    original = {}
    added = []
    identifiers = subprocess.check_output(["docker", "ps", "-q"], text=True).split()
    for identifier in identifiers:
        row = json.loads(subprocess.check_output([
            "docker", "inspect", "--format",
            '{"name":{{json .Name}},"status":{{json .State.Status}},'
            '"started":{{json .State.StartedAt}},"restarts":{{json .RestartCount}},'
            '"labels":{{json .Config.Labels}}}', identifier,
        ], text=True))
        if row["name"] in baseline["containers"]:
            original[row["name"]] = [row["status"], row["started"], str(row["restarts"])]
        else:
            if row["labels"].get("com.docker.compose.project") != "nativark-demo":
                raise RuntimeError("发现本次部署以外的新增容器，需要核定归属")
            added.append(row["name"])
    if original != baseline["containers"]:
        raise RuntimeError("原容器状态、启动时间或重启次数发生变化")

    configs = {}
    for file in Path("/etc/nginx").rglob("*.conf"):
        if file.is_file():
            try:
                configs[str(file)] = hashlib.sha256(file.read_bytes()).hexdigest()
            except PermissionError:
                continue
    if configs != baseline["configs"]:
        raise RuntimeError("原 Nginx 配置发生变化")
    statuses = {}
    for resource in ["/", "/assets/index-02c8ef2c.js"]:
        connection = http.client.HTTPConnection("127.0.0.1", 80, timeout=8)
        try:
            connection.request("GET", resource)
            response = connection.getresponse()
            response.read()
            statuses[resource] = response.status
        finally:
            connection.close()
        if statuses[resource] != baseline["http"]["80" + resource]:
            raise RuntimeError("原站点首页或静态资源响应发生变化")
    print(json.dumps({"originalServices": "unchanged", "originalContainers": len(original),
                      "newNativarkContainers": added, "http": statuses}))


if __name__ == "__main__":
    main()
