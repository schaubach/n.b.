"""Use Compose's effective environment for both the container and the WebApp."""
import json
import pathlib
import subprocess


def write_mail_config(directory):
    directory = pathlib.Path(directory)
    result = subprocess.run(
        ["docker", "compose", "config", "--format", "json"],
        cwd=directory, check=True, capture_output=True, text=True,
    )
    config = json.loads(result.stdout)
    secret = config["services"]["mail-api"]["environment"].get("NB_MAIL_PSK")
    if not isinstance(secret, str) or not secret or secret != secret.strip():
        raise ValueError("NB_MAIL_PSK muss gesetzt sein und darf keine aeusseren Leerzeichen enthalten.")
    # Compose doubles dollar signs when rendering a reusable config document.
    secret = secret.replace("$$", "$")
    public_key = (directory / "identity/public.pem").read_text(encoding="utf-8")
    target = directory / "webapp/mail-backend-config.json"
    target.parent.mkdir(exist_ok=True)
    target.write_text(json.dumps({
        "preSharedKey": secret,
        "backendIdentityPublicKey": public_key,
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    target.chmod(0o644)


if __name__ == "__main__":
    try:
        write_mail_config(pathlib.Path(__file__).resolve().parents[1])
    except subprocess.CalledProcessError:
        raise SystemExit("Docker-Compose-Konfiguration konnte nicht ausgewertet werden. Bitte docker compose config pruefen.")
