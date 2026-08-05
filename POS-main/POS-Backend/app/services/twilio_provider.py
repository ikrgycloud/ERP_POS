"""Provider-based Twilio notification senders."""
import asyncio
import base64
import json
import urllib.parse
import urllib.request
import urllib.error
import logging
from dataclasses import dataclass

from app.core.config import settings

logger = logging.getLogger("pos_api.notifications")
logger = logging.getLogger("pos_api.notifications")


@dataclass
class SendResult:
    sid: str | None = None
    error: str | None = None
    http_status: int | None = None
    twilio_code: int | str | None = None
    response_body: str | None = None

    @property
    def ok(self) -> bool:
        return self.error is None


class NotificationProvider:
    async def send(self, to: str, body: str) -> SendResult:
        raise NotImplementedError


class TwilioBaseProvider(NotificationProvider):
    def __init__(self, from_number: str | None):
        self.from_number = from_number

    @property
    def configured(self) -> bool:
        return bool(settings.TWILIO_ACCOUNT_SID and settings.TWILIO_AUTH_TOKEN and self.from_number)

    async def send(self, to: str, body: str) -> SendResult:
        if not self.configured:
            return SendResult(error="Twilio provider is not configured")
        return await asyncio.to_thread(self._send_sync, to, body)

    def _send_sync(self, to: str, body: str) -> SendResult:
        url = (
            "https://api.twilio.com/2010-04-01/Accounts/"
            f"{settings.TWILIO_ACCOUNT_SID}/Messages.json"
        )
        data = urllib.parse.urlencode(
            {
                "From": self.from_number,
                "To": to,
                "Body": body,
            }
        ).encode("utf-8")
        auth = base64.b64encode(
            f"{settings.TWILIO_ACCOUNT_SID}:{settings.TWILIO_AUTH_TOKEN}".encode("utf-8")
        ).decode("ascii")
        request = urllib.request.Request(
            url,
            data=data,
            method="POST",
            headers={
                "Authorization": f"Basic {auth}",
                "Content-Type": "application/x-www-form-urlencoded",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                raw_body = response.read().decode("utf-8", errors="replace")
                payload = json.loads(raw_body)
                sid = payload.get("sid")
                logger.info(
                    "event=twilio_send_response channel=%s http_status=%s sid=%s error_code=%s",
                    self.__class__.__name__,
                    response.status,
                    sid,
                    payload.get("code"),
                )
                return SendResult(
                    sid=sid,
                    http_status=response.status,
                    twilio_code=payload.get("code"),
                    response_body=raw_body,
                )
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            twilio_code = None
            try:
                twilio_code = json.loads(detail).get("code")
            except Exception:
                pass
            logger.warning(
                "event=twilio_send_response channel=%s http_status=%s error_code=%s body=%s",
                self.__class__.__name__,
                exc.code,
                twilio_code,
                detail or exc.reason,
            )
            return SendResult(
                error=f"Twilio HTTP {exc.code}: {detail or exc.reason}",
                http_status=exc.code,
                twilio_code=twilio_code,
                response_body=detail,
            )
        except Exception as exc:
            logger.warning(
                "event=twilio_send_response channel=%s http_status=none error=%s",
                self.__class__.__name__,
                exc,
            )
            return SendResult(error=str(exc))


class TwilioSmsProvider(TwilioBaseProvider):
    def __init__(self):
        super().__init__(settings.TWILIO_PHONE_NUMBER)


class TwilioWhatsAppProvider(TwilioBaseProvider):
    def __init__(self):
        sender = settings.TWILIO_WHATSAPP_NUMBER
        if sender and not sender.startswith("whatsapp:"):
            sender = f"whatsapp:{sender}"
        super().__init__(sender)

    async def send(self, to: str, body: str) -> SendResult:
        recipient = to if to.startswith("whatsapp:") else f"whatsapp:{to}"
        return await super().send(recipient, body)
