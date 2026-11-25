"""更新 nativark-demo 的 API 和 Web。GitHub CI、数据库基线和回退均在这里核对。"""

import argparse
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import signal
import subprocess
import tarfile
import tempfile
import urllib.error
import urllib.request


REPOSITORY = "JinPen-G/Zelo"
GIT_URL = f"https://github.com/{REPOSITORY}.git"
CI_URL = f"https://api.github.com/repos/{REPOSITORY}/actions/workflows/nativark-release.yml/runs"
ROOT = Path("/home/ritiadm/zelo")
STATE = ROOT / ".hourly-update"
OVERRIDE = ROOT / "compose.override.yml"
ACTIVE = STATE / "active.json"
JOURNAL = STATE / "rollback.json"
PENDING = STATE / "pending-migration.json"
FAILED = STATE / "failed-release.json"
COMPOSE = ("docker", "compose", "-p", "nativark-demo", "-f", str(ROOT / "compose.yml"))
SERVICES = ("api", "web")
PRISMA = ("apps/api/prisma/schema.prisma", "apps/api/prisma/migrations/")
REVISION = '{{index .Config.Labels "org.opencontainers.image.revision"}}'
IMAGE_ID = re.compile(r"sha256:[a-f0-9]{64}\Z")
SHA = re.compile(r"[a-f0-9]{40}\Z")
MEDIA = "media/rest-player/all-too-well-10-minute-version.mp3"
MEDIA_SHA = "2c06b9bd5f056434cd80ec76b995607923fcc9451c51b7997d95b07f732ccf5b"


def run(*args, capture=False, timeout=60, **kwargs):
    result = subprocess.run(
        args, check=True, stdout=subprocess.PIPE if capture else None,
        timeout=timeout, **kwargs,
    )
    return result.stdout.decode().strip() if capture else None


def store(path, text):
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as temp:
        temp_name = temp.name
        try:
            temp.write(text)
            temp.flush()
            os.fsync(temp.fileno())
            os.replace(temp_name, path)
        finally:
            Path(temp_name).unlink(missing_ok=True)


def write_json(path, value):
    store(path, json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def status(state, **detail):
    message = {"status": state, **detail}
    previous = STATE / "status.json"
    if not previous.exists() or json.loads(previous.read_text(encoding="utf-8")) != message:
        print(json.dumps(message, ensure_ascii=False), flush=True)
        write_json(previous, message)


def ci_approved(runs, commit):
    matching = [
        item for item in runs
        if item.get("head_sha") == commit
        and item.get("head_branch") == "main"
        and item.get("event") == "push"
        and item.get("path") == ".github/workflows/nativark-release.yml"
        and (item.get("head_repository") or {}).get("full_name", "").casefold() == REPOSITORY.casefold()
    ]
    latest = max(matching, key=lambda item: item["id"], default={})
    if latest.get("status") == "completed" and latest.get("conclusion") == "success":
        return latest["id"]
    return None


def ci_run(commit):
    url = f"{CI_URL}?branch=main&event=push&head_sha={commit}&per_page=20"
    request = urllib.request.Request(url, headers={
        "User-Agent": "Zelo-hourly-update", "Accept": "application/vnd.github+json",
    })
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return ci_approved(json.load(response)["workflow_runs"], commit)
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return None
        raise


def remote_main():
    result = run("git", "ls-remote", "--exit-code", GIT_URL, "refs/heads/main", capture=True)
    commit, ref = result.split()
    if not SHA.fullmatch(commit) or ref != "refs/heads/main":
        raise RuntimeError("无法固定 GitHub main 提交")
    return commit


def inspect_image(image, field):
    return run("docker", "image", "inspect", "--format", field, image, capture=True)


def current():
    images = {}
    for service in SERVICES:
        name = f"nativark-demo-{service}-1"
        template = '{{.Image}} {{.State.Health.Status}} {{index .Config.Labels "com.docker.compose.project"}}'
        image, health, project = run("docker", "inspect", "--format", template, name, capture=True).split()
        if not IMAGE_ID.fullmatch(image) or health != "healthy" or project != "nativark-demo":
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


def git_snapshot(work, live, commit):
    repo = work / "repo"
    run("git", "init", "--quiet", "--bare", str(repo))
    run("git", "-C", str(repo), "fetch", "--quiet", "--depth=1", GIT_URL, live, commit, timeout=180)
    contents = run("git", "-C", str(repo), "diff", "--name-status", "--no-renames",
                   live, commit, "--", *PRISMA, capture=True)
    return repo, contents


def override_text(tags):
    return (
        "# Nativark hourly update managed images\nservices:\n"
        + "".join(f"  {service}:\n    image: {tags[service]}\n" for service in SERVICES)
    )


def switch(tags, expected):
    store(OVERRIDE, override_text(tags))
    run(*COMPOSE, "-f", str(OVERRIDE), "--profile", "app", "up", "-d", "--no-deps",
        "--no-build", "--pull", "never", "--wait", "--wait-timeout", "180", *SERVICES, timeout=210)
    if current() != expected:
        raise RuntimeError("启动镜像与指定版本不一致")
    smoke()


def restore():
    old = json.loads(JOURNAL.read_text(encoding="utf-8"))
    switch(old["tags"], old["images"])
    write_json(FAILED, {"commit": old["commit"], "ci": old["ci"]})
    # 回退固定在同一套旧镜像，后续人工 compose up 也会选用它。
    JOURNAL.unlink()
    status("rolled-back", commit=old["commit"], images=old["images"])


@contextmanager
def git_source_archive(repo, commit):
    paths = (
        "package.json", "package-lock.json", "tsconfig.base.json", "LICENSE", "apps", "packages",
        "assets", "config", "scripts/ops/deployment", "tests/fixtures/ai-native/prisma-offline-preload.cjs",
        "scripts/build-selected-prisma.cjs", "scripts/miniprogram-shared-types.cjs",
    )
    with subprocess.Popen(
        ["git", "-C", str(repo), "archive", commit, "--", *paths], stdout=subprocess.PIPE
    ) as process:
        try:
            with tarfile.open(fileobj=process.stdout, mode="r|") as archive:
                yield archive
        finally:
            process.stdout.close()
        if process.wait(timeout=30) != 0:
            raise RuntimeError("Git 固定源码归档失败")


def git_source(repo, commit, destination):
    with git_source_archive(repo, commit) as archive:
        archive.extractall(destination, filter="data")


def check_local_copies(dockerfile, members):
    sources = []
    for line in re.sub(r"\\\r?\n", " ", dockerfile).splitlines():
        instruction = re.match(r"^\s*COPY\s+((?:--\S+\s+)*)(.+)$", line, re.IGNORECASE)
        if instruction is None:
            continue
        options, arguments = instruction.groups()
        # --from 消费镜像或前序构建层，其路径由 Docker 构建负责核验。
        if any(option.startswith("--from=") for option in options.split()):
            continue
        paths = json.loads(arguments) if arguments.startswith("[") else shlex.split(arguments)
        if not isinstance(paths, list) or len(paths) < 2 or not all(isinstance(path, str) for path in paths):
            raise RuntimeError("无法解析 Dockerfile 本地 COPY")
        sources.extend(path.removeprefix("./").lstrip("/").rstrip("/") for path in paths[:-1])
    missing = sorted(set(sources) - members)
    if missing:
        raise RuntimeError("源码归档缺少本地 COPY 输入 " + ", ".join(missing))
    return sources


def build(repo, work, commit):
    source = work / "source"
    source.mkdir()
    git_source(repo, commit, source)
    audio = source / "apps/admin/public" / MEDIA
    audio.parent.mkdir(parents=True, exist_ok=True)
    run("docker", "cp", f"nativark-demo-web-1:/usr/share/nginx/html/{MEDIA}", str(audio))
    with audio.open("rb") as file:
        digest = hashlib.sha256()
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
        if digest.hexdigest() != MEDIA_SHA:
            raise RuntimeError("现有私有播放器媒体摘要变化，停止发布以保留线上资源")
    os.chmod(audio, 0o644)
    tags = {service: f"nativark-{service}:{commit}" for service in SERVICES}
    for service, tag in tags.items():
        run("nice", "-n", "15", "docker", "build", "--progress=plain",
            "--file", str(source / "scripts/ops/deployment/Dockerfile"),
            "--target", service, "--build-arg", f"PRODUCT_COMMIT={commit}", "--tag", tag,
            str(source), timeout=1500)
        if inspect_image(tag, REVISION) != commit:
            raise RuntimeError(f"{service} 镜像版本标签不匹配")
    expected = {service: inspect_image(tag, "{{.Id}}") for service, tag in tags.items()}
    return tags, expected


def update(apply):
    if OVERRIDE.exists() and not OVERRIDE.read_text(encoding="utf-8").startswith(
        "# Nativark hourly update managed images\n"
    ):
        raise RuntimeError("已有其他来源的 Compose override")
    if JOURNAL.exists():
        if apply:
            restore()
        else:
            status("recovery-needed")
        return
    images = current()
    smoke()
    live = inspect_image(images["api"], REVISION)
    if not SHA.fullmatch(live):
        raise RuntimeError("当前 API 缺完整提交标识，无法判断数据库兼容性")
    commit = remote_main()
    if commit == live == inspect_image(images["web"], REVISION):
        status("current", commit=commit)
        return
    with tempfile.TemporaryDirectory(dir=STATE, prefix="run-") as directory:
        work = Path(directory)
        repo, changed = git_snapshot(work, live, commit)
        if changed:
            pending = {"live": live, "commit": commit, "paths": changed.splitlines()}
            write_json(PENDING, pending)
            status("awaiting-migration-approval", **pending)
            return
        PENDING.unlink(missing_ok=True)
        approved = ci_run(commit)
        if approved is None:
            status("waiting-for-ci", commit=commit)
            return
        if FAILED.exists() and json.loads(FAILED.read_text(encoding="utf-8")) == {
            "commit": commit, "ci": approved,
        }:
            status("holding-failed-release", commit=commit, ci=approved)
            return
        if not apply:
            status("ready", commit=commit, ci=approved)
            return
        preview = run("systemctl", "show", "preview-update.service", "-p",
                      "ActiveState", "--value", capture=True)
        if preview in {"active", "activating", "deactivating"}:
            status("waiting-for-preview-build", commit=commit)
            return
        status("building", commit=commit, ci=approved)
        tags, expected = build(repo, work, commit)
        if remote_main() != commit or ci_run(commit) != approved or current() != images:
            status("baseline-changed", commit=commit)
            return
        smoke()
        old = {service: f"nativark-{service}:rollback-{image.removeprefix('sha256:')}"
               for service, image in images.items()}
        for service in SERVICES:
            run("docker", "image", "tag", images[service], old[service])
        write_json(JOURNAL, {"commit": commit, "ci": approved, "images": images, "tags": old})
        try:
            switch(tags, expected)
            write_json(ACTIVE, {"commit": commit, "ci": approved, "images": expected, "previous": old})
            JOURNAL.unlink()
        except BaseException:
            restore()
            raise
        status("deployed", commit=commit, ci=approved)


def self_test():
    commit = "a" * 40
    success = {
        "id": 9, "head_sha": commit, "head_branch": "main", "event": "push",
        "path": ".github/workflows/nativark-release.yml", "head_repository": {"full_name": REPOSITORY},
        "status": "completed", "conclusion": "success",
    }
    assert ci_approved([success], commit) == 9
    assert ci_approved([success], "b" * 40) is None
    assert ci_approved([success, dict(success, id=10, status="in_progress")], commit) is None
    assert ci_approved([dict(success, event="pull_request"), dict(success, conclusion="failure")], commit) is None
    assert ci_approved([dict(success, head_repository={"full_name": "Other/Zelo"})], commit) is None
    print("CI 固定版本门禁检查通过")

    repo = Path(__file__).resolve().parents[3]
    commit = run("git", "-C", str(repo), "rev-parse", "--verify", "HEAD^{commit}", capture=True)
    assert SHA.fullmatch(commit)
    members = set()
    files = set()
    dockerfile = None
    # 消费与正式构建相同的固定 Git 归档流，避免工作区文件掩盖白名单遗漏。
    with git_source_archive(repo, commit) as archive:
        for member in archive:
            members.add(member.name.rstrip("/"))
            if member.isfile():
                files.add(member.name)
            if member.name == "scripts/ops/deployment/Dockerfile":
                dockerfile = archive.extractfile(member).read().decode("utf-8")
    if dockerfile is None:
        raise RuntimeError("源码归档缺少 Dockerfile")
    sources = check_local_copies(dockerfile, members)
    required = {"scripts/build-selected-prisma.cjs", "scripts/miniprogram-shared-types.cjs"}
    assert required <= set(sources)
    assert all(path.startswith("scripts/ops/deployment/") or path in required
               for path in files if path.startswith("scripts/"))
    for missing in sorted(required):
        try:
            check_local_copies(dockerfile, members - {missing})
        except RuntimeError as error:
            assert str(error) == "源码归档缺少本地 COPY 输入 " + missing
        else:
            raise AssertionError(f"缺文件反例未被拒绝 {missing}")
    assert check_local_copies(
        'COPY --chown=node ["one", "two", "/app/"]\n'
        'COPY three \\\n    four /app/\nCOPY --from=build /generated /app/\n',
        {"one", "two", "three", "four"},
    ) == ["one", "two", "three", "four"]
    print(json.dumps({"self_test": "git-source-copy", "commit": commit,
                      "archive_files": len(files), "local_copy_sources": len(sources),
                      "missing_source_cases": len(required)}, ensure_ascii=False))


def interrupted(signum, frame):
    raise InterruptedError(f"收到信号 {signum}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--apply", action="store_true")
    mode.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
    else:
        import fcntl

        os.umask(0o077)
        os.chdir(ROOT)
        STATE.mkdir(mode=0o700, exist_ok=True)
        os.environ["GIT_TERMINAL_PROMPT"] = "0"
        signal.signal(signal.SIGTERM, interrupted)
        with (STATE / "job.lock").open("a") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise SystemExit(0)
            update(args.apply)
