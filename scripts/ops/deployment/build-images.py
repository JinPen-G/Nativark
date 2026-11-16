"""从已核定的 Git 源码归档构建 Nativark Linux 镜像，不读取运行凭据。"""

import argparse
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tarfile


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--release", type=Path, required=True)
    options = parser.parse_args()
    root = Path(__file__).resolve().parents[3]
    release = options.release.resolve()
    manifest = json.loads((release / "source-manifest.json").read_text(encoding="utf-8"))
    commit = manifest["productCommit"]
    source = (release / "source.tar").read_bytes()
    if hashlib.sha256(source).hexdigest() != manifest["archiveSha256"]:
        raise RuntimeError("源码归档摘要不一致")
    media = Path(manifest["mediaReference"]["localPath"]).read_bytes()
    if hashlib.sha256(media).hexdigest() != manifest["mediaReference"]["sha256"]:
        raise RuntimeError("指定播放器媒体摘要不一致")

    # 部署补片只增加原版本的企业端 TS 安装记录，逐项保留既有锁记录与版本。
    original_lock = json.loads(subprocess.check_output(
        ["git", "show", commit + ":package-lock.json"], cwd=root))
    lock_bytes = (root / "package-lock.json").read_bytes()
    lock = json.loads(lock_bytes)
    added = "apps/enterprise-portal/node_modules/typescript"
    if set(lock["packages"]) != set(original_lock["packages"]) | {added}:
        raise RuntimeError("锁文件补片超出已核范围")
    for name, value in original_lock["packages"].items():
        if lock["packages"][name] != value:
            raise RuntimeError("既有锁记录被改动")
    if lock["packages"][added] != original_lock["packages"]["apps/admin/node_modules/typescript"]:
        raise RuntimeError("企业端编译器与原锁版本不一致")

    extras = {
        "Dockerfile": (root / "scripts/ops/deployment/Dockerfile").read_bytes(),
        "scripts/ops/deployment/nginx.conf": (root / "scripts/ops/deployment/nginx.conf").read_bytes(),
        "scripts/ops/deployment/streams.conf": (root / "scripts/ops/deployment/streams.conf").read_bytes(),
        "package-lock.json": lock_bytes,
        "tests/fixtures/ai-native/prisma-offline-preload.cjs": subprocess.check_output(
            ["git", "show", commit + ":tests/fixtures/ai-native/prisma-offline-preload.cjs"], cwd=root),
        manifest["mediaReference"]["destination"]: media,
    }
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode="w:", format=tarfile.USTAR_FORMAT) as context:
        with tarfile.open(fileobj=io.BytesIO(source)) as original:
            for member in original:
                if member.name in extras:
                    continue
                member.pax_headers = {}
                context.addfile(member, original.extractfile(member) if member.isfile() else None)
        for name, data in extras.items():
            member = tarfile.TarInfo(name)
            member.size = len(data)
            member.mode = 0o644
            context.addfile(member, io.BytesIO(data))
    archive = stream.getvalue()
    for target in ["api", "web"]:
        image = "nativark-" + target + ":" + commit[:12]
        print(json.dumps({"building": target, "image": image}), flush=True)
        with (release / ("build-" + target + ".log")).open("wb") as log:
            process = subprocess.Popen([
                "docker", "build", "--progress=plain", "--target", target,
                "--build-arg", "PRODUCT_COMMIT=" + commit, "--tag", image, "-",
            ], cwd=root, stdin=subprocess.PIPE, stdout=log, stderr=subprocess.STDOUT)
            process.communicate(archive)
        print(json.dumps({"target": target, "exitCode": process.returncode}), flush=True)
        if process.returncode:
            raise SystemExit(process.returncode)


if __name__ == "__main__":
    main()
