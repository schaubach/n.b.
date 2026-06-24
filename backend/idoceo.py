"""Helpers to decrypt and parse iDoceo (.idoceo / .template.idoceo) archives.

The archive is a classic ZipCrypto-encrypted ZIP (password protected) where the
entries also use a data descriptor (general purpose bit 3). Standard unzip tools
sometimes wrongly report a bad password, so we decrypt ZipCrypto manually by
reading the central directory + local headers, exactly like the reference
repair script provided.

Archive layout:
    idoceo_template.xml         -> <notepad> (class) + <student> entries
    files/student_<sid>.jpg     -> photo for student with sid=<sid>
"""
from __future__ import annotations

import base64
import binascii
import io
import struct
import zipfile
import zlib
import xml.etree.ElementTree as ET

CRC_TABLE = []
for _n in range(256):
    _c = _n
    for _ in range(8):
        _c = (0xEDB88320 ^ (_c >> 1)) if (_c & 1) else (_c >> 1)
    CRC_TABLE.append(_c)


def _crc32_update(old_crc: int, byte: int) -> int:
    return ((old_crc >> 8) ^ CRC_TABLE[(old_crc ^ byte) & 0xFF]) & 0xFFFFFFFF


def _init_keys(password: bytes):
    keys = [0x12345678, 0x23456789, 0x34567890]
    for b in password:
        _update_keys(keys, b)
    return keys


def _update_keys(keys, plain_byte: int) -> None:
    keys[0] = _crc32_update(keys[0], plain_byte)
    keys[1] = (keys[1] + (keys[0] & 0xFF)) & 0xFFFFFFFF
    keys[1] = (keys[1] * 134775813 + 1) & 0xFFFFFFFF
    keys[2] = _crc32_update(keys[2], (keys[1] >> 24) & 0xFF)


def _decrypt(data: bytes, password: bytes) -> bytes:
    keys = _init_keys(password)
    out = bytearray()
    for cipher_byte in data:
        temp = (keys[2] | 2) & 0xFFFFFFFF
        key_byte = ((temp * (temp ^ 1)) >> 8) & 0xFF
        plain_byte = cipher_byte ^ key_byte
        _update_keys(keys, plain_byte)
        out.append(plain_byte)
    return bytes(out)


def _local_data_offset(zip_bytes: bytes, info: zipfile.ZipInfo) -> int:
    off = info.header_offset
    if zip_bytes[off:off + 4] != b"PK\x03\x04":
        raise ValueError(f"Ungueltiger lokaler ZIP-Header bei {info.filename!r}")
    fields = struct.unpack_from("<IHHHHHIIIHH", zip_bytes, off)
    name_len, extra_len = fields[9], fields[10]
    return off + 30 + name_len + extra_len


def _decompress(payload: bytes, method: int) -> bytes:
    if method == zipfile.ZIP_STORED:
        return payload
    if method == zipfile.ZIP_DEFLATED:
        return zlib.decompress(payload, -15)
    raise NotImplementedError(f"Kompressionsmethode {method} nicht unterstuetzt")


def extract_idoceo(zip_bytes: bytes, password: str = "test") -> dict:
    """Returns {filename: raw_bytes} for every file entry in the archive."""
    pw = password.encode("utf-8")
    result: dict[str, bytes] = {}
    with zipfile.ZipFile(io.BytesIO(zip_bytes), "r") as zin:
        for info in zin.infolist():
            if info.is_dir():
                continue
            data_start = _local_data_offset(zip_bytes, info)
            blob = zip_bytes[data_start:data_start + info.compress_size]
            if info.flag_bits & 0x1:
                if len(blob) < 12:
                    raise ValueError(f"Datenblock zu kurz bei {info.filename!r}")
                blob = _decrypt(blob, pw)[12:]
            plain = _decompress(blob, info.compress_type)
            crc = binascii.crc32(plain) & 0xFFFFFFFF
            if crc != info.CRC:
                raise ValueError(
                    "Entschluesselung fehlgeschlagen (vermutlich falsches Passwort)."
                )
            result[info.filename] = plain
    return result


def parse_idoceo(zip_bytes: bytes, password: str = "test") -> dict:
    """Parses an .idoceo archive into a normalized structure.

    Returns:
        {
          "class": {"idoceo_nid": str, "name": str},
          "students": [
             {"idoceo_sid": str, "first_name": str, "last_name": str,
              "order": int, "photo": "data:image/jpeg;base64,..." | None}
          ]
        }
    """
    files = extract_idoceo(zip_bytes, password)

    xml_name = next((n for n in files if n.endswith("idoceo_template.xml")), None)
    if not xml_name:
        xml_name = next((n for n in files if n.endswith(".xml")), None)
    if not xml_name:
        raise ValueError("Keine idoceo_template.xml im Archiv gefunden.")

    root = ET.fromstring(files[xml_name].decode("utf-8"))
    notepad = root.find("notepad")
    if notepad is None:
        raise ValueError("Kein <notepad> (Klasse) im Archiv gefunden.")

    class_info = {
        "idoceo_nid": notepad.get("nid", ""),
        "name": notepad.get("name", "Unbenannte Klasse"),
    }

    # index photos by sid: files/student_<sid>.jpg
    photo_by_sid: dict[str, str] = {}
    for fname, data in files.items():
        low = fname.lower()
        if "/files/" in ("/" + low) or low.startswith("files/"):
            base = low.rsplit("/", 1)[-1]
            if base.startswith("student_"):
                sid = base[len("student_"):].split(".")[0]
                mime = "image/png" if base.endswith(".png") else "image/jpeg"
                photo_by_sid[sid] = (
                    f"data:{mime};base64," + base64.b64encode(data).decode("ascii")
                )

    students = []
    for st in notepad.iter("student"):
        sid = st.get("sid", "")
        students.append({
            "idoceo_sid": sid,
            "first_name": (st.get("name") or "").strip(),
            "last_name": (st.get("lastname") or "").strip(),
            "order": int(st.get("order") or 0),
            "photo": photo_by_sid.get(sid),
        })
    students.sort(key=lambda s: s["order"])
    return {"class": class_info, "students": students}
