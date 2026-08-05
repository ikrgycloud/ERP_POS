"""QR/mobile evidence uploads for return requests."""
import hashlib
import hmac
import secrets
from base64 import urlsafe_b64decode, urlsafe_b64encode
from datetime import UTC, datetime, timedelta
from pathlib import Path
from urllib.parse import urlencode

from fastapi import UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import BusinessRuleError, NotFoundError
from app.models.sales import Return, ReturnEvidence

ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
JPEG_SIGNATURE = b"\xff\xd8\xff"
RIFF_SIGNATURE = b"RIFF"
WEBP_SIGNATURE = b"WEBP"


def upload_limit_label() -> str:
    size_mb = settings.MAX_UPLOAD_BYTES / (1024 * 1024)
    return f"{size_mb:.1f} MB".rstrip("0").rstrip(".")


def _is_supported_image(content_type: str, data: bytes) -> bool:
    if content_type == "image/png":
        return (
            len(data) >= 24
            and data.startswith(PNG_SIGNATURE)
            and data[12:16] == b"IHDR"
        )
    if content_type == "image/jpeg":
        return len(data) >= 4 and data.startswith(JPEG_SIGNATURE)
    if content_type == "image/webp":
        return (
            len(data) >= 12
            and data.startswith(RIFF_SIGNATURE)
            and data[8:12] == WEBP_SIGNATURE
        )
    return False


class ReturnEvidenceService:
    def __init__(self, db: AsyncSession):
        self.db = db

    @staticmethod
    def token_hash(token: str) -> str:
        return hmac.new(
            settings.SECRET_KEY.encode("utf-8"),
            token.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()

    @staticmethod
    def public_url(
        token: str, api_base: str | None = None, frontend_base: str | None = None
    ) -> str:
        base_url = settings.public_frontend_base_url(frontend_base)
        url = (
            f"{base_url}/return-evidence/{token}"
            if base_url
            else f"/return-evidence/{token}"
        )
        if api_base:
            return f"{url}?{urlencode({'api': api_base})}"
        return url

    @staticmethod
    def _b64(data: bytes) -> str:
        return urlsafe_b64encode(data).decode("ascii").rstrip("=")

    @staticmethod
    def _unb64(data: str) -> bytes:
        padded = data + "=" * (-len(data) % 4)
        return urlsafe_b64decode(padded.encode("ascii"))

    @classmethod
    def _signed_token(cls, return_id: int, expires_at: datetime, nonce: str) -> str:
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=UTC)
        expires = expires_at.astimezone(UTC).isoformat()
        payload = f"{return_id}|{expires}|{nonce}"
        signature = hmac.new(
            settings.SECRET_KEY.encode("utf-8"),
            payload.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        return cls._b64(f"{payload}:{signature}".encode())

    @classmethod
    def verify_signed_token(cls, token: str) -> tuple[int, datetime] | None:
        try:
            decoded = cls._unb64(token).decode("utf-8")
            payload, signature = decoded.rsplit(":", 1)
            return_id, expires, _nonce = payload.split("|", 2)
        except Exception:
            return None
        expected = hmac.new(
            settings.SECRET_KEY.encode("utf-8"),
            payload.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(signature, expected):
            return None
        try:
            expires_at = datetime.fromisoformat(expires)
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=UTC)
            return int(return_id), expires_at
        except ValueError:
            return None

    async def create_upload_link(
        self,
        ret: Return,
        *,
        business_profile_id: int,
    ) -> tuple[str, datetime]:
        if ret.business_profile_id != business_profile_id:
            raise NotFoundError("Return not found")
        if ret.status in {"completed", "rejected"}:
            raise BusinessRuleError("Evidence upload is closed for this return")
        expires_at = datetime.now(UTC) + timedelta(
            hours=settings.RETURN_EVIDENCE_LINK_EXPIRY_HOURS
        )
        token = self._signed_token(ret.id, expires_at, secrets.token_urlsafe(12))
        return token, expires_at

    async def get_upload_info(self, token: str) -> tuple[Return, datetime]:
        verified = self.verify_signed_token(token)
        if not verified:
            raise NotFoundError("Evidence upload link not found or expired")
        return_id, expires_at = verified
        if expires_at < datetime.now(UTC):
            raise NotFoundError("Evidence upload link not found or expired")
        ret = await self.db.get(Return, return_id)
        if not ret or ret.status in {"completed", "rejected"}:
            raise NotFoundError("Evidence upload link not found or expired")
        return ret, expires_at

    async def list_for_return(
        self,
        return_id: int,
        *,
        business_profile_id: int,
    ) -> list[ReturnEvidence]:
        stmt = (
            select(ReturnEvidence)
            .where(
                ReturnEvidence.return_id == return_id,
                ReturnEvidence.business_profile_id == business_profile_id,
            )
            .order_by(ReturnEvidence.uploaded_at.desc(), ReturnEvidence.id.desc())
        )
        return (await self.db.execute(stmt)).scalars().all()

    async def has_evidence(
        self,
        return_id: int,
        *,
        business_profile_id: int,
    ) -> bool:
        stmt = (
            select(ReturnEvidence.id)
            .where(
                ReturnEvidence.return_id == return_id,
                ReturnEvidence.business_profile_id == business_profile_id,
            )
            .limit(1)
        )
        return (await self.db.execute(stmt)).scalar_one_or_none() is not None

    async def save_public_upload(
        self,
        token: str,
        file: UploadFile,
        note: str | None = None,
    ) -> ReturnEvidence:
        ret, _expires_at = await self.get_upload_info(token)
        content_type = (file.content_type or "").lower()
        if content_type not in ALLOWED_IMAGE_TYPES:
            raise BusinessRuleError("Evidence must be a JPG, PNG, or WEBP image")

        suffix = Path(file.filename or "").suffix.lower()
        if suffix not in {".jpg", ".jpeg", ".png", ".webp"}:
            suffix = {
                "image/jpeg": ".jpg",
                "image/png": ".png",
                "image/webp": ".webp",
            }[content_type]

        upload_root = Path(settings.UPLOAD_DIR)
        if not upload_root.is_absolute():
            upload_root = Path.cwd() / upload_root
        evidence_dir = upload_root / "return-evidence" / str(ret.id)
        evidence_dir.mkdir(parents=True, exist_ok=True)

        stored_name = f"{secrets.token_urlsafe(16)}{suffix}"
        destination = evidence_dir / stored_name
        size = 0
        header = b""
        with destination.open("wb") as output:
            while chunk := await file.read(1024 * 1024):
                if len(header) < 32:
                    header += chunk[: 32 - len(header)]
                size += len(chunk)
                if size > settings.MAX_UPLOAD_BYTES:
                    destination.unlink(missing_ok=True)
                    limit = upload_limit_label()
                    raise BusinessRuleError(
                        "Evidence image is too large. "
                        f"Please upload an image up to {limit}."
                    )
                output.write(chunk)

        if not size or not _is_supported_image(content_type, header):
            destination.unlink(missing_ok=True)
            raise BusinessRuleError(
                "Evidence must be a valid JPG, PNG, or WEBP image"
            )

        media_path = f"return-evidence/{ret.id}/{stored_name}"
        file_url = f"/media/{media_path}"
        evidence = ReturnEvidence(
            return_id=ret.id,
            business_profile_id=ret.business_profile_id,
            outlet_id=ret.outlet_id,
            uploaded_by_staff_id=ret.staff_id,
            token_hash=self.token_hash(token),
            original_name=file.filename or stored_name,
            stored_name=stored_name,
            file_url=file_url,
            file_path=str(destination),
            content_type=content_type,
            file_size=size,
            note=note,
            uploaded_at=datetime.now(UTC),
        )
        self.db.add(evidence)
        await self.db.flush()
        await self.db.refresh(evidence)
        return evidence
