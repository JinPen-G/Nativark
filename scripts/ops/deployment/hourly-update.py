"""保留现有组合与已记录的回退。正式双仓只观察本机镜像，发布和迁移另行核准。"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import tarfile
import tempfile
from threading import Timer


ROOT = Path("/home/ritiadm/zelo")
STATE = ROOT / ".hourly-update"
OVERRIDE = ROOT / "compose.override.yml"
JOURNAL = STATE / "rollback.json"
PENDING = STATE / "pending-migration.json"
FAILED = STATE / "failed-release.json"
PROJECT = "nativark-demo"
COMPOSE = ("docker", "compose", "-p", PROJECT, "-f", str(ROOT / "compose.yml"))
SERVICES = ("api", "web")
IMAGE_ID = re.compile(r"sha256:[a-f0-9]{64}\Z")
SHA = re.compile(r"[a-f0-9]{40}\Z")
DIGEST = re.compile(r"[a-f0-9]{64}\Z")
OVERRIDE_HEADER = "# Nativark hourly update managed images\n"


def run(*args, capture=False, timeout=60, **kwargs):
    result = subprocess.run(
        args, check=True, stdout=subprocess.PIPE if capture else None,
        timeout=timeout, **kwargs,
    )
    return result.stdout.decode().strip() if capture else None


def store(path, text):
    temp = tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False)
    try:
        with temp:
            temp.write(text)
            temp.flush()
            os.fsync(temp.fileno())
        os.replace(temp.name, path)
    finally:
        Path(temp.name).unlink(missing_ok=True)


def write_json(path, value):
    store(path, json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def status(state, **detail):
    message = {"status": state, **detail}
    previous = STATE / "status.json"
    if not previous.exists() or json.loads(previous.read_text(encoding="utf-8")) != message:
        print(json.dumps(message, ensure_ascii=False), flush=True)
        write_json(previous, message)


def current():
    images = {}
    for service in SERVICES:
        name = f"{PROJECT}-{service}-1"
        template = '{{.Image}} {{.State.Health.Status}} {{index .Config.Labels "com.docker.compose.project"}}'
        image, health, project = run("docker", "inspect", "--format", template, name, capture=True).split()
        if not IMAGE_ID.fullmatch(image) or health != "healthy" or project != PROJECT:
            raise RuntimeError(f"当前 {service} 未达到健康及回退基线")
        images[service] = image
    return images


def smoke():
    for url in (
        "https://rentaltest.rimo.pro:8080/login",
        "https://rentaltest.rimo.pro:8080/api/health",
        "http://127.0.0.1/", "http://127.0.0.1:8088/brand/version.json",
    ):
        body = run("curl", "--max-time", "8", "--fail", "--silent", "--show-error",
                   "--resolve", "rentaltest.rimo.pro:8080:127.0.0.1", url, capture=True, timeout=10)
        if not body or (url.endswith("/login") and "<html" not in body.lower()):
            raise RuntimeError(f"运行验收失败 {url}")


def override_text(tags):
    return (
        OVERRIDE_HEADER + "services:\n"
        + "".join(f"  {service}:\n    image: {tags[service]}\n" for service in SERVICES)
    )


def switch(tags, expected):
    # 缺失或被重打标签的旧镜像不能写入有效 override。
    for service in SERVICES:
        actual = run("docker", "image", "inspect", "--format", "{{.Id}}", tags[service], capture=True)
        if not IMAGE_ID.fullmatch(actual) or actual != expected[service]:
            raise RuntimeError(f"{service} 的本机镜像与切换记录不一致")
    store(OVERRIDE, override_text(tags))
    run(*COMPOSE, "-f", str(OVERRIDE), "--profile", "app", "up", "-d", "--no-deps",
        "--no-build", "--pull", "never", "--wait", "--wait-timeout", "180", *SERVICES, timeout=210)
    if current() != expected:
        raise RuntimeError("启动镜像与指定版本不一致")
    smoke()


def restore():
    old = json.loads(JOURNAL.read_text(encoding="utf-8"))
    if (not SHA.fullmatch(old["commit"]) or type(old["ci"]) is not int or old["ci"] < 1
            or set(old["images"]) != set(SERVICES)
            or len(set(old["images"].values())) != 2
            or any(not IMAGE_ID.fullmatch(image) for image in old["images"].values())
            or old["tags"] != {role: f"nativark-{role}:rollback-{image.removeprefix('sha256:')}"
                              for role, image in old["images"].items()}):
        raise RuntimeError("原回退记录与镜像标签不一致")
    switch(old["tags"], old["images"])
    write_json(FAILED, {"commit": old["commit"], "ci": old["ci"]})
    # 回退固定在同一套旧镜像，后续人工 compose up 也会选用它。
    JOURNAL.unlink()
    status("rolled-back", commit=old["commit"], images=old["images"])


def config_digest(image):
    # 新 Docker 以 OCI manifest 为 .Id；按固定 ID 导出并核原 manifest 字节。
    image_id = image["Id"]
    if (image.get("Descriptor") or {}).get("digest") != image_id:
        raise RuntimeError("缺少 Docker 原始 manifest 身份")
    name = "blobs/sha256/" + image_id.removeprefix("sha256:")
    manifest_bytes = None
    with subprocess.Popen(["docker", "image", "save", image_id], stdout=subprocess.PIPE) as process:
        deadline = Timer(120, process.kill)
        deadline.start()
        try:
            with tarfile.open(fileobj=process.stdout, mode="r|") as archive:
                for item in archive:
                    if item.name == name:
                        if manifest_bytes is not None or not item.isfile() or item.size > 65536:
                            raise RuntimeError("Docker manifest 须为有界普通文件")
                        manifest_bytes = archive.extractfile(item).read()
            if process.wait(timeout=10) != 0:
                raise RuntimeError("Docker 镜像观察失败")
        finally:
            deadline.cancel()
            if process.poll() is None:
                process.kill()
    if manifest_bytes is None or "sha256:" + hashlib.sha256(manifest_bytes).hexdigest() != image_id:
        raise RuntimeError("Docker manifest 原文摘要不一致")
    manifest = json.loads(manifest_bytes)
    if manifest.get("schemaVersion") != 2 or not isinstance(manifest.get("layers"), list):
        raise RuntimeError("须为单平台运行镜像 manifest")
    return manifest.get("config", {}).get("digest")


def observe_pair(receipt, expected_digest):
    with Path(receipt).open("rb") as file:
        raw = file.read(65537)
    if len(raw) > 65536 or hashlib.sha256(raw).hexdigest() != expected_digest:
        raise RuntimeError("双镜像回执与独立核收摘要不一致")
    record = json.loads(raw)
    if (record.get("format") != "rental-image-pair-1" or record.get("releaseApproved") is not False
            or record.get("serverUpdateEligible") is not False):
        raise RuntimeError("缺少正式配对构建回执")
    run_id, attempt = record["runId"], record["runAttempt"]
    labels = {
        "org.opencontainers.image.revision": record["platformCommit"],
        "pro.zelo.rental.commit": record["rentalCommit"],
        "pro.zelo.release.identity": record["identitySha256"],
        "pro.zelo.release.deployment-lock": record["deploymentLockSha256"],
        "pro.zelo.release.npm-lock": record["npmLockSha256"],
        "pro.zelo.release.build-provenance": record["buildProvenanceSha256"],
    }
    if (any(type(value) is not int or value < 1 for value in (run_id, attempt))
            or not SHA.fullmatch(record["platformCommit"]) or not SHA.fullmatch(record["rentalCommit"])
            or any(not DIGEST.fullmatch(value) for value in list(labels.values())[2:])):
        raise RuntimeError("双镜像回执缺少完整来源和摘要")
    labels["pro.zelo.release.ci"] = f"{run_id}/{attempt}"
    expected = record["imageIds"]
    if (set(expected) != set(SERVICES) or len(set(expected.values())) != 2
            or any(not IMAGE_ID.fullmatch(value) for value in expected.values())):
        raise RuntimeError("配对回执须含两项固定镜像摘要")
    runtime_ids = {}
    for role in SERVICES:
        tag = f"zelo-rental-{role}:ci-{run_id}-{attempt}"
        image = json.loads(run("docker", "image", "inspect", "--format", "{{json .}}", tag, capture=True))
        actual_labels = image["Config"]["Labels"]
        if (not IMAGE_ID.fullmatch(image["Id"]) or (image.get("Os"), image.get("Architecture")) != ("linux", "amd64")
                or (role == "api" and image["Config"].get("User") != "node")
                or any(actual_labels.get(key) != value for key, value in labels.items())
                or actual_labels.get("pro.zelo.release.role") != role
                or (image["Id"] != expected[role] and config_digest(image) != expected[role])):
            raise RuntimeError(f"{role} 实际镜像与同次正式配对不一致")
        runtime_ids[role] = image["Id"]
    return {**expected, "runtimeImageIds": runtime_ids}


def update(apply):
    if OVERRIDE.is_symlink() or (OVERRIDE.exists() and not OVERRIDE.read_text(encoding="utf-8").startswith(OVERRIDE_HEADER)):
        raise RuntimeError("已有其他来源的 Compose override")
    if JOURNAL.exists():
        if apply:
            restore()
        else:
            status("recovery-needed")
        return
    images = current()
    smoke()
    status("holding-current-pair", images=images, legacyMigrationPending=PENDING.is_file())


def interrupted(signum, frame):
    raise InterruptedError(f"收到信号 {signum}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--apply", action="store_true")
    mode.add_argument("--observe-pair", nargs=2, metavar=("RECEIPT", "SHA256"))
    args = parser.parse_args()
    if args.observe_pair:
        print(json.dumps(observe_pair(*args.observe_pair)))
    else:
        import fcntl

        os.umask(0o077)
        os.chdir(ROOT)
        STATE.mkdir(mode=0o700, exist_ok=True)
        signal.signal(signal.SIGTERM, interrupted)
        with (STATE / "job.lock").open("a") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise SystemExit(0)
            update(args.apply)
