"""发现官方正式双仓候选，沿原核验和本机授权成对更新。数据变化交维护窗口处理。"""

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import subprocess
import tarfile
import tempfile
from threading import Timer
import urllib.request
from urllib.parse import urlsplit
import zipfile


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
PAIR_OVERRIDE = ROOT / "compose.pair-images.yml"
ACTIVE_PAIR = STATE / "paired-active.json"
AUTHORIZATION = STATE / "paired-authorization.json"
REPOSITORY = "JinPen-G/Zelo"
REPOSITORY_ID = 1332293015
WORKFLOW_ID = 431931928
WORKFLOW_PATH = ".github/workflows/rental-release-candidate.yml"
VERSION = re.compile(r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\Z")
VERIFIER = STATE / "verifier" / "scripts" / "ops" / "release-verify.cjs"
NODE = "/opt/preview/node-v24.13.0-linux-x64/bin/node"
VERSION_ROLES = ("platform", "rental")
# 固定核收工具随本更新器安装。不能执行下载候选自行提供的验证代码。
VERIFIER_FILES = {
    "scripts/ops/release-verify.cjs": "125d958dfb95fbac33a0461eff54aadc5ed82ed2a722fc4f32d65c95b288e7f2",
    "scripts/ops/release-composition.cjs": "b41a828cb473da96b91886d3cb683196f4b7a2f69c70df1e4be86b7c77a21aa8",
    "scripts/ops/release-build-evidence.cjs": "55846235cd96db49a1bcf87d58b742b581be09a4c6ff5bad7def331f1ac922f8",
}


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


def switch(tags, expected, paired=False):
    # 缺失或被重打标签的旧镜像不能写入有效 override。
    for service in SERVICES:
        actual = run("docker", "image", "inspect", "--format", "{{.Id}}", tags[service], capture=True)
        if not IMAGE_ID.fullmatch(actual) or actual != expected[service]:
            raise RuntimeError(f"{service} 的本机镜像与切换记录不一致")
    destination = PAIR_OVERRIDE if paired else OVERRIDE
    store(destination, override_text(tags))
    overlays = ["-f", str(OVERRIDE)]
    if paired:
        overlays += ["-f", str(PAIR_OVERRIDE)]
    run(*COMPOSE, *overlays, "--profile", "app", "up", "-d", "--no-deps",
        "--no-build", "--pull", "never", "--wait", "--wait-timeout", "180", *SERVICES, timeout=210)
    if current() != expected:
        raise RuntimeError("启动镜像与指定版本不一致")
    smoke()


def restore():
    old = json.loads(JOURNAL.read_text(encoding="utf-8"))
    if old.get("format") == "zelo-paired-rollback-1":
        # 新日志保存原完整本地基线。这里只回退已批准无数据变化的镜像对。
        baseline = old["active"]
        expected = baseline["imageIds"]
        tags = rollback_tags(expected)
        if (old.get("runtimeConfigurationSha256") != runtime_configuration()
                or old.get("tags") != tags or not DIGEST.fullmatch(old.get("candidateIdentitySha256", ""))):
            raise RuntimeError("配对回退记录或现场运行配置已变化，须人工恢复")
        switch(tags, expected, paired=True)
        write_json(ACTIVE_PAIR, baseline)
        write_json(FAILED, {"identitySha256": old["candidateIdentitySha256"]})
        JOURNAL.unlink()
        status("rolled-back", images=expected)
        return
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


def file_digest(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as file:
        for block in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def private_json(path):
    if path.resolve() != path.absolute():
        raise RuntimeError("本机发布材料不能经过符号链接")
    info = path.lstat()
    if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid()
            or info.st_mode & 0o077 or info.st_size > 65536):
        raise RuntimeError("本机授权和基线须为当前运维用户独占的有界普通文件")
    return json.loads(path.read_text(encoding="utf-8"))


class GitHubRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, url):
        if urlsplit(url).scheme != "https":
            raise RuntimeError("发布材料重定向须保持 HTTPS")
        redirected = super().redirect_request(request, response, code, message, headers, url)
        if urlsplit(url).hostname != urlsplit(request.full_url).hostname:
            redirected.remove_header("Authorization")
        return redirected


def request(url, accept="application/vnd.github+json"):
    headers = {"User-Agent": "Zelo-paired-updater", "Accept": accept}
    token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    if token and urlsplit(url).hostname == "api.github.com":
        headers["Authorization"] = "Bearer " + token
    return urllib.request.build_opener(GitHubRedirect()).open(
        urllib.request.Request(url, headers=headers), timeout=60)


def github(path):
    with request("https://api.github.com/repos/" + path) as response:
        raw = response.read(4 * 1024 * 1024 + 1)
    if len(raw) > 4 * 1024 * 1024:
        raise RuntimeError("GitHub 元数据超过上限")
    return json.loads(raw)


def official_run(value):
    return (value.get("repository", {}).get("id") == REPOSITORY_ID
            and value.get("head_repository", {}).get("id") == REPOSITORY_ID
            and value.get("workflow_id") == WORKFLOW_ID and value.get("path") == WORKFLOW_PATH
            and value.get("event") == "workflow_dispatch" and value.get("head_branch") == "main"
            and value.get("status") == "completed" and value.get("conclusion") == "success"
            and SHA.fullmatch(value.get("head_sha", ""))
            and all(type(value.get(key)) is int and value[key] > 0 for key in ("id", "run_attempt")))


def discover():
    runs = github(f"{REPOSITORY}/actions/workflows/{WORKFLOW_ID}/runs?branch=main&event=workflow_dispatch&status=success&per_page=20")
    candidates = [value for value in runs.get("workflow_runs", []) if official_run(value)]
    if not candidates:
        return None
    candidate = max(candidates, key=lambda value: (value["run_number"], value["run_attempt"]))
    current_run = github(f"{REPOSITORY}/actions/runs/{candidate['id']}")
    if not official_run(current_run) or current_run["run_attempt"] != candidate["run_attempt"]:
        raise RuntimeError("候选运行已重试或失去成功状态")
    return current_run


def download(url, destination, expected, limit, size=None, accept="application/vnd.github+json"):
    if not DIGEST.fullmatch(expected):
        raise RuntimeError("下载材料缺少独立 SHA-256")
    total = 0
    with request(url, accept) as response, destination.open("xb") as file:
        for block in iter(lambda: response.read(1024 * 1024), b""):
            total += len(block)
            if total > limit:
                raise RuntimeError("下载材料超过固定上限")
            file.write(block)
    if (size is not None and size != total) or file_digest(destination) != expected:
        raise RuntimeError("发行材料原字节与可信摘要不一致")


def artifact(run_record, artifacts, kind, directory):
    name = f"rental-image-{kind}-{run_record['id']}-{run_record['run_attempt']}"
    matches = [item for item in artifacts if item.get("name") == name]
    if len(matches) != 1:
        raise RuntimeError("同次正式材料缺失或重复，须重新正式配对")
    item = matches[0]
    origin = item.get("workflow_run", {})
    digest = item.get("digest", "")
    if (item.get("expired") is not False or not re.fullmatch(r"sha256:[a-f0-9]{64}", digest)
            or any(origin.get(key) != value for key, value in {
                "id": run_record["id"], "repository_id": REPOSITORY_ID,
                "head_repository_id": REPOSITORY_ID, "head_branch": "main",
                "head_sha": run_record["head_sha"],
            }.items())):
        raise RuntimeError("产物来源、有效期或 GitHub 摘要不完整")
    archive = directory / (kind + ".zip")
    download(f"https://api.github.com/repos/{REPOSITORY}/actions/artifacts/{item['id']}/zip",
             archive, digest[7:], 512 * 1024 * 1024, item["size_in_bytes"])
    destination = directory / kind
    destination.mkdir()
    seen, total = set(), 0
    with zipfile.ZipFile(archive) as package:
        for entry in package.infolist():
            name = entry.filename.rstrip("/")
            parts = name.split("/")
            mode = stat.S_IFMT(entry.external_attr >> 16)
            if (not name or name.casefold() in seen or any(part in ("", ".", "..") for part in parts)
                    or "\\" in name or ":" in name or name.startswith("/") or "\x00" in name
                    or mode not in (0, stat.S_IFREG, stat.S_IFDIR)):
                raise RuntimeError("产物含重复、链接或越界路径")
            seen.add(name.casefold())
            if kind == "pair" and name not in ("image-pair.json", "rental-images.tar.gz", "SHA256SUMS"):
                raise RuntimeError("镜像产物含未声明文件")
            if kind == "input" and parts[0] not in ("api", "web", "input.json"):
                raise RuntimeError("交接产物含未声明目录")
            total += entry.file_size
            if len(seen) > 6000 or total > 512 * 1024 * 1024:
                raise RuntimeError("解包材料超过上限")
            target = destination.joinpath(*parts)
            if entry.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with package.open(entry) as source, target.open("xb") as output:
                    shutil.copyfileobj(source, output)
    archive.unlink()
    return destination


def stable_version(value):
    if not isinstance(value, str) or not VERSION.fullmatch(value):
        raise RuntimeError("自动更新只接受三段稳定版本")
    return tuple(int(part) for part in value.split("."))


def verify_release(repository, version, commit, digest, prefix, directory):
    stable_version(version)
    tag = "v" + version
    release = github(f"{repository}/releases/tags/{tag}")
    if (release.get("draft") is not False or release.get("prerelease") is not False
            or release.get("tag_name") != tag or not release.get("published_at")):
        raise RuntimeError("须为已公开稳定 Release")
    ref = github(f"{repository}/git/ref/tags/{tag}")["object"]
    for _ in range(5):
        if ref.get("type") != "tag":
            break
        ref = github(f"{repository}/git/tags/{ref['sha']}")["object"]
    if ref.get("type") != "commit" or ref.get("sha") != commit:
        raise RuntimeError("正式 Tag 解引用与固定源码不同")
    name = f"{prefix}-{version}.tgz"
    matches = [asset for asset in release.get("assets", []) if asset.get("name") == name]
    if len(matches) != 1 or matches[0].get("state") != "uploaded":
        raise RuntimeError("正式 Release 缺少唯一原资产")
    asset = matches[0]
    if asset.get("digest") is not None and asset["digest"] != "sha256:" + digest:
        raise RuntimeError("Release 资产摘要与部署锁不同")
    download(f"https://api.github.com/repos/{repository}/releases/assets/{asset['id']}",
             directory / name, digest, 128 * 1024 * 1024, asset["size"], "application/octet-stream")


def review(candidate, baseline, evidence, context_digest):
    args = [NODE, str(VERIFIER), "paired-review", str(candidate), context_digest,
            baseline.get("directory", "legacy-combined"), baseline.get("contextSha256", "-"), str(evidence)]
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=90)
    if result.returncode != 2:
        raise RuntimeError("原 paired-review 未返回有效待审批结论")
    value = json.loads(result.stdout)
    if value.get("scope") != "paired-update-review" or value.get("serverUpdateEligible") is not False:
        raise RuntimeError("原配对复核范围不完整")
    return value


def verify_input(inputs, manifest, baseline):
    # 沿原 readPrepared 重核候选与基线身份。Web 摘要沿原 digestFiles 的 localeCompare 顺序。
    javascript = r'''
const path = require('node:path'), crypto = require('node:crypto');
const { readPrepared, readReleaseFiles } = require(process.argv[1]);
const [root, contextSha, baselineDir, baselineSha] = process.argv.slice(2);
const candidate = readPrepared(path.join(root, 'api'), contextSha, { requireFixedBuild: true });
const files = readReleaseFiles(path.join(root, 'web'));
if (!files.get('index.html')?.length || files.has('.dockerignore')) throw Error('Web入口缺失');
const digest = crypto.createHash('sha256');
for (const [file, bytes] of [...files].sort(([a], [b]) => a.localeCompare(b)))
  digest.update(file + ':' + crypto.createHash('sha256').update(bytes).digest('hex') + '\n');
const previous = baselineDir ? readPrepared(baselineDir, baselineSha, { requireFixedBuild: true }) : null;
console.log(JSON.stringify({ candidate: candidate.identitySha256, web: digest.digest('hex'),
  baseline: previous?.identitySha256, versions: candidate.versions, previousVersions: previous?.versions }));
'''
    result = json.loads(run(NODE, "-e", javascript, str(VERIFIER), str(inputs), manifest["contextSha256"],
                            baseline.get("directory", ""), baseline.get("contextSha256", ""), capture=True, timeout=90))
    if result["candidate"] != manifest["identitySha256"] or result["web"] != manifest["webFilesSha256"]:
        raise RuntimeError("实际 API/Web 材料与同次交接摘要不一致")
    if baseline and (result.get("baseline") != baseline.get("identitySha256")
                     or result.get("previousVersions") != baseline.get("versions")):
        raise RuntimeError("原双仓基线身份或版本与实际材料不一致")
    return result["versions"]


def authorization_valid(value, configuration):
    try:
        expires = datetime.fromisoformat(value["validUntil"])
        return (value.get("format") == "zelo-paired-authorization-1"
                and value.get("scope") == "official-pair-no-data-change"
                and isinstance(value.get("approvalReference"), str) and bool(value["approvalReference"].strip())
                and value.get("runtimeConfigurationSha256") == configuration
                and expires.tzinfo is not None and expires > datetime.now(timezone.utc))
    except (KeyError, TypeError, ValueError):
        return False


def runtime_configuration(require_default_startup=False):
    args = [*COMPOSE, "-f", str(OVERRIDE)]
    if PAIR_OVERRIDE.exists():
        if PAIR_OVERRIDE.is_symlink() or not PAIR_OVERRIDE.read_text().startswith(OVERRIDE_HEADER):
            raise RuntimeError("已有其他来源的配对镜像 override")
        args += ["-f", str(PAIR_OVERRIDE)]
    config = json.loads(run(*args, "--profile", "app", "config", "--format", "json", capture=True))
    if any(service not in config.get("services", {}) for service in SERVICES):
        raise RuntimeError("展开配置缺少 app profile 的 API/Web")
    if require_default_startup and any(
            config["services"][service].get(field) is not None
            for service in SERVICES for field in ("command", "entrypoint")):
        return None
    for service in SERVICES:
        config["services"][service].pop("image", None)
    # 只保留摘要。Compose 展开后的环境变量不能进入日志或公开回执。
    return hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()


def rollback_tags(images):
    if (set(images) != set(SERVICES) or len(set(images.values())) != 2
            or any(not IMAGE_ID.fullmatch(value) for value in images.values())):
        raise RuntimeError("缺少完整回退镜像对")
    return {role: "nativark-" + role + ":rollback-" + image[7:] for role, image in images.items()}


def pending(reason, run_record, **detail):
    value = {"format": "zelo-paired-pending-1", "status": reason,
             "runId": run_record["id"], "runAttempt": run_record["run_attempt"], **detail}
    write_json(STATE / "pending-pair.json", value)
    status(reason, **{key: item for key, item in value.items() if key != "status"})


def check_candidate(run_record, directory, images, apply):
    artifacts = github(f"{REPOSITORY}/actions/runs/{run_record['id']}/artifacts?per_page=100")["artifacts"]
    pair = artifact(run_record, artifacts, "pair", directory)
    inputs = artifact(run_record, artifacts, "input", directory)
    receipt = pair / "image-pair.json"
    record = json.loads(receipt.read_text())
    manifest = json.loads((inputs / "input.json").read_text())
    if (file_digest(inputs / "input.json") != record.get("inputSha256")
            or record.get("runId") != run_record["id"] or record.get("runAttempt") != run_record["run_attempt"]
            or record.get("platformCommit") != run_record["head_sha"]
            or manifest.get("sourceMode") != "release" or manifest.get("format") != "rental-image-input-1"
            or manifest.get("toolCommit") != run_record["head_sha"]
            or any(manifest.get(key) != record.get(key) for key in (
                "platformCommit", "rentalCommit", "identitySha256", "deploymentLockSha256", "npmLockSha256", "webFilesSha256"))):
        raise RuntimeError("同运行的镜像与交接回执不一致")
    policy = {"origin": "manual", "repositoryId": REPOSITORY_ID, "workflowId": WORKFLOW_ID,
              "workflowPath": WORKFLOW_PATH, "headSource": "platform", "runId": run_record["id"],
              "runAttempt": run_record["run_attempt"], "buildRecordSha256": file_digest(receipt)}
    write_json(pair / "policy.json", policy)
    write_json(pair / "run.json", run_record)
    write_json(pair / "images.json", record["imageIds"])
    baseline = private_json(ACTIVE_PAIR) if ACTIVE_PAIR.exists() else {}
    if baseline:
        base_directory = Path(baseline["directory"])
        if (not base_directory.is_absolute() or base_directory.resolve() != base_directory
                or STATE / "prepared" not in base_directory.parents):
            raise RuntimeError("基线须为本机已核收留存的普通 prepared 目录")
        baseline_receipt = base_directory.parent / "image-pair.json"
        baseline_record = json.loads(baseline_receipt.read_text())
        if (baseline_record.get("identitySha256") != baseline.get("identitySha256")
                or observe_pair(baseline_receipt, baseline["imagePairSha256"])["runtimeImageIds"] != images):
            raise RuntimeError("本机基线的构建回执与实际运行镜像不同")
    versions = verify_input(inputs, manifest, baseline)
    checked = review(inputs / "api", baseline, pair, manifest["contextSha256"])
    lock = json.loads((inputs / "api/apps/rental-api/prisma-deployment/core.deployment.lock.json").read_text())
    lock = lock.get("base", lock)
    for role, repository, prefix, digest in (
        ("platform", REPOSITORY, "platform-source", lock["platform"]["sha256"]),
        ("rental", "JinPen-G/Zelo-rental-core", "rental", lock["cores"][0]["sha256"]),
    ):
        verify_release(repository, versions[role], record[role + "Commit"], digest, prefix, directory)
    detail = {"platformCommit": record["platformCommit"], "rentalCommit": record["rentalCommit"],
              "identitySha256": checked["identitySha256"], "versions": versions}
    if checked["status"] != "awaiting-release-approval":
        pending(checked["status"], run_record, **detail)
        return
    if PENDING.exists():
        pending("awaiting-migration-approval", run_record, **detail)
        return
    if (baseline.get("format") != "zelo-paired-active-1" or baseline.get("imageIds") != images
            or not isinstance(baseline.get("dataApprovalReference"), str) or not baseline["dataApprovalReference"].strip()
            or baseline.get("runtimeConfigurationSha256") != runtime_configuration()):
        pending("awaiting-baseline-review", run_record, **detail)
        return
    if any(stable_version(versions[role]) < stable_version(baseline["versions"][role]) for role in VERSION_ROLES):
        pending("refused-version-downgrade", run_record, **detail)
        return
    if versions == baseline["versions"]:
        pending("holding-current-version", run_record, **detail)
        return
    if not AUTHORIZATION.exists():
        pending("awaiting-release-approval", run_record, **detail)
        return
    # 显式旧库命令绑定原发行挂载。替换镜像前须由维护窗口重新核收该启动材料。
    if runtime_configuration(require_default_startup=True) is None:
        pending("awaiting-runtime-binding-review", run_record, **detail)
        return
    authorization = private_json(AUTHORIZATION)
    if not authorization_valid(authorization, baseline["runtimeConfigurationSha256"]):
        pending("awaiting-release-approval", run_record, **detail)
        return
    if FAILED.exists() and private_json(FAILED).get("identitySha256") == checked["identitySha256"]:
        pending("holding-failed-pair", run_record, **detail)
        return
    if not apply:
        pending("ready-for-authorized-pair-update", run_record, **detail)
        return
    sums = (pair / "SHA256SUMS").read_text().splitlines()
    expected_sums = {name: digest for digest, name in (line.split("  ", 1) for line in sums)}
    if (len(sums) != 2 or set(expected_sums) != {"image-pair.json", "rental-images.tar.gz"}
            or any(file_digest(pair / name) != digest for name, digest in expected_sums.items())):
        raise RuntimeError("同次镜像留存摘要不一致")
    with tarfile.open(pair / "rental-images.tar.gz", "r:gz") as archive:
        names, total, docker_manifest = set(), 0, None
        for entry in archive:
            if (entry.name in names or entry.name.startswith("/") or ".." in entry.name.split("/")
                    or not (entry.isfile() or entry.isdir())):
                raise RuntimeError("镜像归档含重复、链接或越界路径")
            names.add(entry.name)
            total += entry.size
            if len(names) > 20000 or total > 4 * 1024 * 1024 * 1024:
                raise RuntimeError("镜像归档展开超过上限")
            if entry.name == "manifest.json":
                if not entry.isfile() or entry.size > 65536:
                    raise RuntimeError("镜像归档缺少有界 Docker 清单")
                docker_manifest = json.load(archive.extractfile(entry))
        if not isinstance(docker_manifest, list):
            raise RuntimeError("镜像归档缺少 Docker 清单")
        tags = [tag for item in docker_manifest for tag in item.get("RepoTags", [])]
        wanted = [f"zelo-rental-{role}:ci-{run_record['id']}-{run_record['run_attempt']}" for role in SERVICES]
        if len(docker_manifest) != 2 or sorted(tags) != sorted(wanted):
            raise RuntimeError("镜像归档须仅包含本次两个角色")
    run("docker", "image", "load", "-i", str(pair / "rental-images.tar.gz"), timeout=240)
    observed = observe_pair(receipt, policy["buildRecordSha256"])
    write_json(pair / "images.json", {role: observed[role] for role in SERVICES})
    review(inputs / "api", baseline, pair, manifest["contextSha256"])
    if current() != images or runtime_configuration() != baseline["runtimeConfigurationSha256"]:
        raise RuntimeError("切换前原组合或配置发生变化")
    latest_run = github(f"{REPOSITORY}/actions/runs/{run_record['id']}")
    if (not official_run(latest_run) or latest_run["run_attempt"] != run_record["run_attempt"]
            or latest_run["head_sha"] != run_record["head_sha"]):
        raise RuntimeError("切换前正式 CI 失去成功状态")
    if (PENDING.exists() or private_json(ACTIVE_PAIR) != baseline
            or private_json(AUTHORIZATION) != authorization
            or not authorization_valid(authorization, baseline["runtimeConfigurationSha256"])):
        raise RuntimeError("切换前授权、原基线或迁移状态变化")
    destination = STATE / "prepared" / f"{run_record['id']}-{run_record['run_attempt']}"
    destination.parent.mkdir(exist_ok=True)
    if destination.exists():
        raise RuntimeError("已有同运行恢复材料，须先核收原事务")
    old_tags = rollback_tags(images)
    for role in SERVICES:
        run("docker", "image", "tag", images[role], old_tags[role])
    inputs.rename(destination)
    shutil.copyfile(receipt, destination / "image-pair.json")
    write_json(JOURNAL, {"format": "zelo-paired-rollback-1", "active": baseline, "tags": old_tags,
                        "runtimeConfigurationSha256": baseline["runtimeConfigurationSha256"],
                        "candidateIdentitySha256": checked["identitySha256"]})
    try:
        tags = {role: f"zelo-rental-{role}:ci-{run_record['id']}-{run_record['run_attempt']}" for role in SERVICES}
        switch(tags, observed["runtimeImageIds"], paired=True)
        write_json(ACTIVE_PAIR, {"format": "zelo-paired-active-1", "directory": str(destination / "api"),
                                "contextSha256": manifest["contextSha256"], **detail,
                                "imageIds": observed["runtimeImageIds"],
                                "imagePairSha256": policy["buildRecordSha256"],
                                "dataApprovalReference": baseline["dataApprovalReference"],
                                "runId": run_record["id"], "runAttempt": run_record["run_attempt"],
                                "runtimeConfigurationSha256": baseline["runtimeConfigurationSha256"]})
        (STATE / "pending-pair.json").unlink(missing_ok=True)
        status("updated-pair", **detail, images=observed["runtimeImageIds"])
        JOURNAL.unlink()
    except BaseException:
        if JOURNAL.exists():
            restore()
        raise


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
    candidate = discover()
    if candidate is None:
        status("holding-current-pair", images=images, reason="no-official-successful-pair")
        return
    if (not VERIFIER.is_file() or any(not (STATE / "verifier" / name).is_file()
            or (STATE / "verifier" / name).is_symlink() or file_digest(STATE / "verifier" / name) != digest
            for name, digest in VERIFIER_FILES.items())):
        pending("awaiting-verifier-installation", candidate)
        return
    active = private_json(ACTIVE_PAIR) if ACTIVE_PAIR.exists() else {}
    if (active.get("runId") == candidate["id"] and active.get("runAttempt") == candidate["run_attempt"]
            and active.get("imageIds") == images and active.get("runtimeConfigurationSha256") == runtime_configuration()):
        status("holding-current-pair", images=images, runId=candidate["id"])
        return
    watched = {path.name: file_digest(path) if path.is_file() else None
               for path in (ACTIVE_PAIR, AUTHORIZATION, PENDING, FAILED)}
    watched.update(runId=candidate["id"], runAttempt=candidate["run_attempt"], apply=apply,
                   configuration=runtime_configuration(), updater=file_digest(Path(__file__)))
    poll_digest = hashlib.sha256(json.dumps(watched, sort_keys=True).encode()).hexdigest()
    seen = STATE / "paired-poll.json"
    if seen.exists() and private_json(seen).get("sha256") == poll_digest:
        status("holding-pending-pair", runId=candidate["id"], reason=private_json(seen)["status"])
        return
    # 唯一任务临时目录随成功、失败和中断清理，已采用的 input 另留作下次基线。
    with tempfile.TemporaryDirectory(prefix="paired-", dir=STATE) as directory:
        check_candidate(candidate, Path(directory), images, apply)
    write_json(seen, {"sha256": poll_digest, "status": private_json(STATE / "status.json")["status"]})


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
            try:
                update(args.apply)
            except Exception as error:
                # HTTP 异常可能携带短期下载 URL，子进程参数也不进入状态文件。
                status("update-blocked", reason=str(error) if type(error) is RuntimeError else type(error).__name__)
                raise SystemExit(1)
