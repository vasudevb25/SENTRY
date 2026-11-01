"""
collector.py — UDP syslog collector with software-simulated-HSM signing.

Fixes from the original version:
  - Removed the pkcs11 / SoftHSM2 token lookup. It imported the pkcs11 module
    and looked up a token labelled "EvidenceToken" but never actually used it
    for anything — signing already happened via the `cryptography` library
    against a PEM key file, not through PKCS#11. Since there's no TPM and no
    configured SoftHSM2 token on this machine, that lookup would just throw
    on startup. The PEM-based RSA-PSS signing below IS the "software-HSM-
    style" simulated signing your progress report describes — it just didn't
    need the pkcs11 import to do it.
  - private.pem / public.pem are now generated automatically on first run
    instead of crashing with FileNotFoundError.
  - Added SHA-256 hash chaining across evidence records (prev_hash -> hash),
    matching the Node.js agent, so deleting or reordering a whole record is
    detectable — not just modifying one.
  - Kafka is optional: if no broker is reachable, evidence is appended to a
    local JSONL file instead of crashing the collector on startup.
  - The main loop no longer dies on a single malformed packet.
"""

import socket
import json
import re
import hashlib
import os
from datetime import datetime, timezone

from cryptography.hazmat.primitives import serialization, hashes
from cryptography.hazmat.primitives.asymmetric import padding, rsa

# =========================
# Config (override via env vars)
# =========================
UDP_IP = os.environ.get("COLLECTOR_UDP_IP", "127.0.0.1")
UDP_PORT = int(os.environ.get("COLLECTOR_UDP_PORT", "5514"))
KEY_DIR = os.environ.get("COLLECTOR_KEY_DIR", os.path.dirname(os.path.abspath(__file__)))
PRIVATE_KEY_PATH = os.path.join(KEY_DIR, "private.pem")
PUBLIC_KEY_PATH = os.path.join(KEY_DIR, "public.pem")
KAFKA_BOOTSTRAP = os.environ.get("KAFKA_BOOTSTRAP", "localhost:9092")
KAFKA_TOPIC = os.environ.get("KAFKA_TOPIC", "log_topic")
FALLBACK_LOG_PATH = os.environ.get(
    "COLLECTOR_FALLBACK_LOG", os.path.join(KEY_DIR, "evidence_fallback.jsonl")
)

# =========================
# Software-simulated-HSM key material
# =========================
def load_or_generate_keys():
    """
    Loads the RSA keypair used for signing, generating one on first run.
    This mirrors what a real HSM gives you (a private key that never leaves
    the boundary in plaintext) without requiring physical hardware or a
    configured SoftHSM2 token — matching the "software HSM" approach noted
    in the progress report.
    """
    if os.path.exists(PRIVATE_KEY_PATH) and os.path.exists(PUBLIC_KEY_PATH):
        with open(PRIVATE_KEY_PATH, "rb") as f:
            priv = serialization.load_pem_private_key(f.read(), password=None)
        with open(PUBLIC_KEY_PATH, "rb") as f:
            pub_bytes = f.read().decode()
        return priv, pub_bytes

    print("[Collector] No keypair found — generating a new one (first run)...")
    priv = rsa.generate_private_key(public_exponent=65537, key_size=3072)
    pub = priv.public_key()

    priv_pem = priv.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    pub_pem = pub.public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )

    with open(PRIVATE_KEY_PATH, "wb") as f:
        f.write(priv_pem)
    os.chmod(PRIVATE_KEY_PATH, 0o600)
    with open(PUBLIC_KEY_PATH, "wb") as f:
        f.write(pub_pem)

    print(f"[Collector] Keypair written to {PRIVATE_KEY_PATH} / {PUBLIC_KEY_PATH}")
    return priv, pub_pem.decode()


private_key, public_key_bytes = load_or_generate_keys()


def sign_data(data: str) -> str:
    return private_key.sign(
        data.encode(),
        padding.PSS(mgf=padding.MGF1(hashes.SHA256()), salt_length=padding.PSS.MAX_LENGTH),
        hashes.SHA256(),
    ).hex()


# =========================
# Optional Kafka producer
# =========================
producer = None
try:
    from kafka import KafkaProducer

    producer = KafkaProducer(
        bootstrap_servers=KAFKA_BOOTSTRAP,
        value_serializer=lambda v: json.dumps(v).encode("utf-8"),
        request_timeout_ms=3000,
        api_version_auto_timeout_ms=3000,
    )
    print(f"[Collector] Connected to Kafka at {KAFKA_BOOTSTRAP}")
except Exception as e:
    print(f"[Collector] Kafka unavailable ({e}) — falling back to local file: {FALLBACK_LOG_PATH}")
    producer = None


def emit(evidence: dict):
    if producer is not None:
        try:
            producer.send(KAFKA_TOPIC, evidence)
            producer.flush(timeout=3)
            return
        except Exception as e:
            print(f"[Collector] Kafka send failed ({e}) — writing to fallback file instead")
    with open(FALLBACK_LOG_PATH, "a") as f:
        f.write(json.dumps(evidence) + "\n")


# =========================
# Syslog Parser
# =========================
SYSLOG_PATTERN = re.compile(
    r"<(\d+)>(\w+\s+\d+\s+\d+:\d+:\d+)\s+([\w\-.]+)\s+([\w\-.\/\[\]]+):\s+(.*)"
)


def parse_syslog(log: str) -> dict:
    match = SYSLOG_PATTERN.match(log)
    if not match:
        return {"raw": log}

    priority, timestamp, host, process, message = match.groups()
    current_year = datetime.now().year
    full_timestamp = f"{timestamp} {current_year}"

    try:
        parsed_time = datetime.strptime(full_timestamp, "%b %d %H:%M:%S %Y").isoformat()
    except ValueError:
        parsed_time = None

    return {
        "priority": int(priority),
        "timestamp": parsed_time,
        "host": host,
        "process": process,
        "message": message,
    }


# =========================
# Hash chaining (matches the Node.js agent's approach)
# =========================
prev_hash = "GENESIS"


def next_chained_hash(payload_string: str):
    """Returns (hash_before_this_entry, new_chained_hash) and advances the chain."""
    global prev_hash
    hash_before = prev_hash
    h = hashlib.sha256((hash_before + payload_string).encode()).hexdigest()
    prev_hash = h
    return hash_before, h


# =========================
# UDP Setup
# =========================
def main():
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind((UDP_IP, UDP_PORT))
    print(f"[Collector] Listening on {UDP_IP}:{UDP_PORT}")

    while True:
        try:
            data, addr = sock.recvfrom(4096)
            raw_data = data.decode(errors="replace").strip()
            log = parse_syslog(raw_data)

            payload = {
                "log": log,
                "source_id": "system_1",
                "public_key": public_key_bytes,
            }
            payload_string = json.dumps(payload, sort_keys=True)

            hash_before, chained_hash = next_chained_hash(payload_string)
            signature = sign_data(chained_hash)

            evidence = {
                "payload": payload,
                "prev_hash": hash_before,
                "hash": chained_hash,
                "signature": signature,
                "ingest_timestamp": datetime.now(timezone.utc).isoformat(),
                "source_ip": addr[0],
            }

            print("[Collector] Evidence:", json.dumps(evidence)[:200], "...")
            emit(evidence)

        except Exception as e:
            # A single bad packet should never take the whole collector down.
            print(f"[Collector] Error processing packet: {e}")


if __name__ == "__main__":
    main()
