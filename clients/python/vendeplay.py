"""
Cliente Python (reverse-engineered) para la API de VendePlay CRM.

Solo stdlib. Procedencia: rutas, verbos y auth observados en el front-end
(análisis estático con REA); las formas de payload no están verificadas salvo
el login ({email, password} -> {data:{accessToken, user}}) y sendText.

Dos superficies:
  - API principal  : base https://api.vendeplay.com/streaming-head-seller/v1 , auth Bearer.
  - Gateway WhatsApp: base = plugin self.ws `url` , auth header x-api-key.
"""
from __future__ import annotations

import json
import urllib.request
import urllib.parse
from typing import Any, Callable, Optional

DEFAULT_BASE_URL = "https://api.vendeplay.com/streaming-head-seller/v1"

# transport: (method, url, headers, body_bytes|None) -> (status:int, body_bytes:bytes)
Transport = Callable[[str, str, dict, Optional[bytes]], "tuple[int, bytes]"]


class HttpError(Exception):
    def __init__(self, status: int, body: Any):
        super().__init__(f"HTTP {status}")
        self.status = status
        self.body = body


def _urllib_transport(method: str, url: str, headers: dict, body: Optional[bytes]):
    req = urllib.request.Request(url=url, method=method, data=body, headers=headers)
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:  # type: ignore[attr-defined]
        return e.code, e.read()


class _Http:
    def __init__(self, base_url: str, *, default_headers: Optional[dict] = None,
                 transport: Optional[Transport] = None):
        self.base_url = base_url.rstrip("/")
        self.default_headers = dict(default_headers or {})
        self.transport: Transport = transport or _urllib_transport
        self.access_token: Optional[str] = None
        self.refresh_token: Optional[str] = None

    def _url(self, path: str, query: Optional[dict]) -> str:
        url = self.base_url + (path if path.startswith("/") else "/" + path)
        if query:
            q = {k: v for k, v in query.items() if v is not None}
            if q:
                url += "?" + urllib.parse.urlencode(q)
        return url

    def request(self, method: str, path: str, *, query: Optional[dict] = None,
                body: Any = None, auth: bool = True) -> Any:
        def do():
            headers = {"Accept": "application/json", **self.default_headers}
            payload = None
            if body is not None:
                headers["Content-Type"] = "application/json"
                payload = json.dumps(body).encode("utf-8")
            if auth and self.access_token:
                headers["Authorization"] = f"Bearer {self.access_token}"
            return self.transport(method, self._url(path, query), headers, payload)

        status, raw = do()
        if status == 401 and auth and self._try_refresh():
            status, raw = do()
        return self._parse(status, raw)

    def _parse(self, status: int, raw: bytes) -> Any:
        data: Any = raw.decode("utf-8", "replace") if raw else ""
        if data:
            try:
                data = json.loads(data)
            except ValueError:
                pass
        if status >= 400:
            raise HttpError(status, data)
        return data

    def _try_refresh(self) -> bool:
        body = {"refreshToken": self.refresh_token} if self.refresh_token else {}
        status, raw = self.transport(
            "POST", self._url("/auth/refresh", None),
            {"Content-Type": "application/json", "Accept": "application/json"},
            json.dumps(body).encode("utf-8"),
        )
        if status >= 400:
            return False
        try:
            j = json.loads(raw.decode("utf-8"))
        except Exception:
            return False
        d = j.get("data", j) if isinstance(j, dict) else {}
        token = d.get("accessToken") or d.get("token")
        if token:
            self.access_token = token
            return True
        return False

    def get(self, path, query=None, auth=True):
        return self.request("GET", path, query=query, auth=auth)

    def post(self, path, body=None, auth=True):
        return self.request("POST", path, body=body, auth=auth)

    def put(self, path, body=None):
        return self.request("PUT", path, body=body)

    def patch(self, path, body=None):
        return self.request("PATCH", path, body=body)

    def delete(self, path):
        return self.request("DELETE", path)


class WhatsAppClient:
    """Gateway de mensajería. base_url y api_key provienen del plugin self.ws."""

    def __init__(self, url: str, reference_id: str, token: str,
                 transport: Optional[Transport] = None):
        self.reference_id = reference_id
        self.http = _Http(url, default_headers={"x-api-key": token}, transport=transport)

    # sesión
    def session_status(self):
        return self.http.get(f"/sessions/{self.reference_id}")

    def session_start(self, body=None):
        return self.http.post(f"/sessions/{self.reference_id}/start", body)

    def session_restart(self, body=None):
        return self.http.post(f"/sessions/{self.reference_id}/restart", body)

    def session_logout(self, body=None):
        return self.http.post(f"/sessions/{self.reference_id}/logout", body)

    def qr(self):
        return self.http.get(f"/{self.reference_id}/auth/qr")

    # chats
    def chats_overview(self, **params):
        return self.http.get(f"/{self.reference_id}/chats/overview", params or None)

    def chat_messages(self, chat_id, **params):
        return self.http.get(f"/{self.reference_id}/chats/{chat_id}/messages", params or None)

    def mark_read(self, chat_id, body=None):
        return self.http.post(f"/{self.reference_id}/chats/{chat_id}/messages/read", body)

    def contacts_all(self, **params):
        return self.http.get("/contacts/all", {"session": self.reference_id, **params})

    def contact_profile_picture(self, contact_id):
        return self.http.get("/contacts/profile-picture",
                             {"session": self.reference_id, "contactId": contact_id})

    # envío (payload de send_text confirmado)
    def send_text(self, chat_id, text):
        return self.http.post("/sendText",
                             {"session": self.reference_id, "chatId": chat_id, "text": text})

    def start_typing(self, chat_id):
        return self.http.post("/startTyping", {"session": self.reference_id, "chatId": chat_id})

    def stop_typing(self, chat_id):
        return self.http.post("/stopTyping", {"session": self.reference_id, "chatId": chat_id})


class VendePlayClient:
    def __init__(self, base_url: str = DEFAULT_BASE_URL,
                 transport: Optional[Transport] = None):
        self.http = _Http(base_url, transport=transport)
        self._transport = transport

    # ---- auth ----
    def login(self, email: str, password: str) -> dict:
        res = self.http.post("/auth/login", {"email": email, "password": password}, auth=False)
        data = res.get("data", res) if isinstance(res, dict) else {}
        token = data.get("accessToken")
        if not token:
            raise RuntimeError("login sin accessToken")
        self.http.access_token = token
        return data

    def me(self):
        return self.http.post("/auth/me")

    def refresh(self) -> bool:
        return self.http._try_refresh()

    def logout(self):
        try:
            self.http.post("/auth/logout")
        finally:
            self.http.access_token = None
            self.http.refresh_token = None

    # ---- recursos principales (muestra representativa; mismas rutas que el SDK TS) ----
    def list_clients(self, **q):
        return self.http.get("/clients", q or None)

    def create_client(self, body):
        return self.http.post("/clients", body)

    def get_client(self, cid):
        return self.http.get(f"/clients/{cid}")

    def update_client(self, cid, body):
        return self.http.put(f"/clients/{cid}", body)

    def list_suppliers(self, **q):
        return self.http.get("/suppliers", q or None)

    def list_subscriptions(self, **q):
        return self.http.get("/subscriptions", q or None)

    def cancel_subscription(self, sid, body=None):
        return self.http.patch(f"/subscriptions/{sid}/cancel", body)

    def list_streaming_accounts(self, **q):
        return self.http.get("/streaming-accounts", q or None)

    def list_payments(self, **q):
        return self.http.get("/payments", q or None)

    def metrics_dashboard(self, **q):
        return self.http.get("/metrics/dashboard", q or None)

    def account_plugins(self, **q):
        return self.http.get("/account-plugins", q or None)

    # ---- gateway de WhatsApp ----
    def connect_whatsapp(self) -> WhatsAppClient:
        res = self.account_plugins(name="self.ws", status="ACTIVE")
        lst = res.get("data", res) if isinstance(res, dict) else res
        plugin = lst[0] if isinstance(lst, list) and lst else None
        if not plugin or not plugin.get("url") or not plugin.get("referenceId"):
            raise RuntimeError("no se encontró plugin self.ws ACTIVE")
        return WhatsAppClient(plugin["url"], plugin["referenceId"], plugin["token"],
                              transport=self._transport)
